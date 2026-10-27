#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Lab measurements for docs/testing/LAB-TEST-PLAN.md: non-Latin recall, the save gate, project scope,
// why-explanations, restatements and the graph view. Synthetic data only, in a temporary folder.
//   node scripts/lab/measure.mjs [--json out.json]
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { performance } from 'node:perf_hooks';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const { initVault, Vault } = await import(`${REPO}/src/engine/vault.mjs`);
const { tokenize } = await import(`${REPO}/src/engine/index.mjs`);
const { assess } = await import(`${REPO}/src/engine/quality.mjs`);
const BASE = fs.mkdtempSync(path.join(process.env.MEMEV_TEST_TMP || os.tmpdir(), 'memev-lab-'));
const ID = { id: 'm', agent: 'm', scopes: ['read', 'write'], paths: ['**'] };
const out = {};
// the tokenizer Memev used before the Unicode change, for the old-vs-new comparison
const STOP = new Set('a an and are as at be but by for from has have i if in into is it its of on or our so that the their them then there these they this to was we were what when where which who will with you your not no do does did can could should would just also than too very about after before over under more most some such only own same each other any all both few'.split(' '));
const oldTok = (t) => String(t || '').toLowerCase().normalize('NFKD').split(/[^a-z0-9_.-]+/).map((x) => x.replace(/^[.-]+|[.-]+$/g, '')).filter((x) => x.length >= 2 && x.length <= 40 && !STOP.has(x));
// M1 tokenizer: per-language corpus, query recall@1 with old vs new tokenizer (BM25 over docs, same code path via a vault for new; old measured as "any query token survives")
const corpus = {
  zh: [['我们决定用东京的服务器部署数据库', '东京 服务器'], ['周五不要发布新版本', '发布'], ['登录错误来自缓存层', '缓存'], ['发票导出每晚运行', '发票']],
  ja: [['本番環境のデプロイは金曜日に禁止です', 'デプロイ'], ['ログインのエラーはキャッシュが原因', 'キャッシュ'], ['請求書のエクスポートは毎晩', '請求書']],
  ko: [['배포는 금요일에 하지 않는다', '배포'], ['로그인 오류는 캐시 때문이다', '캐시'], ['청구서 내보내기는 매일 밤', '청구서']],
  ru: [['Мы используем Postgres 16 для отчётов', 'отчётов'], ['Не выпускать релизы в пятницу', 'релизы пятницу'], ['Ошибка входа из-за кэша', 'кэша']],
  el: [['Η βάση δεδομένων τρέχει στη Ζυρίχη', 'δεδομένων'], ['Καμία κυκλοφορία την Παρασκευή', 'Παρασκευή'], ['Το σφάλμα σύνδεσης οφείλεται στην κρυφή μνήμη', 'σφάλμα']],
  ar: [['قاعدة البيانات تعمل على الخادم الرئيسي', 'البيانات'], ['لا إصدارات يوم الجمعة', 'الجمعة'], ['خطأ تسجيل الدخول بسبب ذاكرة التخزين', 'خطأ']],
  he: [['מסד הנתונים רץ בציריך', 'הנתונים'], ['אין שחרורים ביום שישי', 'שחרורים']],
  hi: [['डेटाबेस ज्यूरिख में चलता है', 'डेटाबेस'], ['शुक्रवार को रिलीज़ नहीं', 'शुक्रवार']],
  de_fr: [['Die Straße wird gesperrt für Bauarbeiten', 'straße'], ['Le café naïve est fermé le lundi', 'naive'], ['Ελληνικά und Übergröße', 'ubergroße']],
};
const m1 = {}; let total = 0, oldHit = 0, newHit = 0;
for (const [lang, rows] of Object.entries(corpus)) {
  const root = fs.mkdtempSync(path.join(BASE, 'm1-')); initVault(path.join(root, 'v'), {}); const v = new Vault(path.join(root, 'v'), { git: false, fsync: false, keyDir: path.join(root, 'k') }).open();
  rows.forEach(([t], i) => v.write(ID, { path: `n/${lang}${i}.md`, body: `# n\n${t}\n` }));
  let oh = 0, nh = 0;
  rows.forEach(([t, q], i) => { const ot = new Set(oldTok(t)); if (oldTok(q).some((x) => ot.has(x))) oh++; if (v.recall(ID, { query: q, log: false })[0]?.path === `n/${lang}${i}.md`) nh++; });
  v.close(); fs.rmSync(root, { recursive: true, force: true });
  m1[lang] = { queries: rows.length, old_tokenizer_any_match: oh, new_recall_at_1: nh }; total += rows.length; oldHit += oh; newHit += nh;
}
out.m1_tokenizer = { per_language: m1, total, old_any_match: oldHit, new_recall_at_1: newHit };
// M1b CJK mode sweep (multiplicity: 3 configurations, 1 statistic)
const cjkDocs = corpus.zh.concat(corpus.ja, corpus.ko).map((r) => r[0]);
const cjkQueries = [['东京', 0], ['服务器', 0], ['发布', 1], ['缓存', 2], ['发票', 3], ['デプロイ', 4], ['キャッシュ', 5], ['請求書', 6], ['배포', 7], ['캐시', 8], ['청구서', 9], ['周五', 1], ['导', 3], ['晩', 6]];
const seg = (s, mode) => { const out = []; const c = [...s.replace(/[^\p{L}]/gu, '')]; for (let i = 0; i < c.length; i++) { if (mode !== 'bi') out.push(c[i]); if (mode !== 'uni' && i + 1 < c.length) out.push(c[i] + c[i + 1]); } if (mode === 'bi' && c.length === 1) out.push(c[0]); return out; };
const sweep = {};
for (const mode of ['uni', 'bi', 'uni+bi']) {
  const docs = cjkDocs.map((d) => seg(d, mode)); const N = docs.length; const df = new Map(); for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  let hit = 0, terms = new Set(docs.flat()).size;
  for (const [q, want] of cjkQueries) { const qt = [...new Set(seg(q, mode))]; let best = -1, bs = 0; docs.forEach((d, i) => { let s = 0; for (const t of qt) { const f = d.filter((x) => x === t).length; if (f) s += Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5)) * f; } if (s > bs) { bs = s; best = i; } }); if (best === want) hit++; }
  sweep[mode] = { recall_at_1: `${hit}/${cjkQueries.length}`, distinct_terms: terms };
}
out.m1b_cjk_sweep = sweep;
// M2 project bleed at size: build a vault the way the growth bench does (6 projects, journals, checkpoints, memories)
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648); const pick = (a) => a[Math.floor(rnd() * a.length)];
const W = 'deploy pipeline cache layer database migration login error retry queue worker invoice report export schema index token config docker build test flaky timeout endpoint handler service client server metric alert latency memory disk backup restore branch merge review release feature bug'.split(' ');
const P = ['billing', 'search', 'mobile-app', 'infra', 'docs', 'analytics']; const C = ['claude-code', 'codex', 'cursor', 'gemini-cli'];
const text = (n) => Array.from({ length: n }, () => pick(W)).join(' ');
const root2 = fs.mkdtempSync(path.join(BASE, 'm2-')); initVault(path.join(root2, 'v'), {}); const v2 = new Vault(path.join(root2, 'v'), { git: false, fsync: false, keyDir: path.join(root2, 'k') }).open();
const t0 = performance.now(); let mems = 0;
for (let s = 0; s < 400; s++) { const pr = pick(P), cl = pick(C), sid = `s${s}`; for (let i = 0; i < 30; i++) { v2.journal(ID, { session: sid, client: cl, role: 'user', text: `${pr} ${text(40)}`, project: pr }); if (i % 6 === 5) v2.checkpoint(ID, { project: pr, task: `${pr} work`, done: [`step ${i}`], doing: text(5), next: [text(4)], client: cl, session: sid }); if (i % 10 === 3) { const r = v2.remember(ID, { text: `In ${pr}: ${text(25)}`, kind: pick(['decision', 'fact', 'gotcha']), project: pr, client: cl }); if (r.saved) mems++; } } }
const build = (performance.now() - t0) / 1000;
const leak = (o) => { let other = 0, n = 0; const lat = []; for (let i = 0; i < 500; i++) { const pr = pick(P); const s = performance.now(); const hits = v2.recall(ID, { query: text(6), project: pr, limit: 4, log: false, ...o }); lat.push(performance.now() - s); for (const h of hits) { n++; if (h.project && h.project.replace(/\s+/g, '-') !== pr) other++; } } lat.sort((a, b) => a - b); return { hits: n, from_other_projects: other, share: Number((other / n).toFixed(3)), p50_ms: Number(lat[250].toFixed(2)), p95_ms: Number(lat[475].toFixed(2)) }; };
out.m2_project_bleed = { sections: v2.index.stats().sections, memories_saved: mems, build_s: Number(build.toFixed(1)), boost_only: leak({ all_projects: true }), hard_scope: leak({}) };
// M2b: the same vault plus project-specific vocabulary, queried from one project with a word that belongs to another
const own = Object.fromEntries(P.map((p, i) => [p, Array.from({ length: 8 }, (_, j) => `${p.slice(0, 3)}term${i}${j}`)]));
for (let s = 0; s < 120; s++) { const pr = pick(P); for (let i = 0; i < 10; i++) v2.journal(ID, { session: `t${s}`, client: 'c', role: 'user', text: `${pr} ${text(20)} ${pick(own[pr])} ${pick(own[pr])}`, project: pr }); }
const leak2 = (o) => { let other = 0, n = 0; for (let i = 0; i < 500; i++) { const pr = pick(P); const op = pick(P.filter((x) => x !== pr)); const hits = v2.recall(ID, { query: `${text(3)} ${pick(own[op])}`, project: pr, limit: 4, log: false, ...o }); for (const h of hits) { n++; if (h.project && h.project.replace(/\s+/g, '-') !== pr) other++; } } return { hits: n, from_other_projects: other, share: Number((other / Math.max(1, n)).toFixed(3)) }; };
out.m2b_cross_vocabulary = { boost_only: leak2({ all_projects: true }), hard_scope: leak2({}) };
// M4 explanation exactness at the same size
let exact = 0, n4 = 0; const wl = [];
for (let i = 0; i < 200; i++) { const pr = pick(P), q = text(5); const hits = v2.recall(ID, { query: q, project: pr, log: false, limit: 3 }); const s = performance.now(); const w = v2.why(ID, { query: q, project: pr, limit: 3 }); wl.push(performance.now() - s); hits.forEach((h, j) => { n4++; const it = w.items[j]; if (it && it.item === `${h.path}#${h.heading || ''}` && Math.abs(it.score - h.score) < 1e-3) { const e = it.explanation; const sum = e.words.reduce((a, x) => a + x.contribution, 0) * e.project_multiplier * e.feedback_multiplier; if (Math.abs(sum - h.score) < 0.01 * Math.max(1, h.score)) exact++; } }); }
wl.sort((a, b) => a - b);
out.m4_explain = { items_checked: n4, explanation_equals_score: exact, why_p50_ms: Number(wl[100].toFixed(2)), why_p95_ms: Number(wl[190].toFixed(2)) };
// M3b audit at size
const sa = performance.now(); const au = v2.audit(ID); out.m3b_audit_at_size = { memories: au.memories, likely_junk: au.likely_junk, counts: au.counts, ms: Math.round(performance.now() - sa) };
v2.close(); fs.rmSync(root2, { recursive: true, force: true });
// M3 save gate on a small labelled set: 20 junk notes in six classes and 15 good ones
const junk = [ 'ok thanks', 'Done.', 'got it', 'heartbeat ok', 'NO_REPLY', 'cron job ran at 02:00', 'sure', 'use tabs', 'yes', 'thanks!',
  'For now I am debugging the login page', 'Currently debugging the flaky upload test', 'Today we are looking at the cache', 'Temporarily disabled the lint step', 'This session is about the invoice bug',
  'Agent uses she/her pronouns', 'Operator prefers Telegram', 'User is a software developer', 'Assistant should respond formally', 'The user said hello' ];
const junkClass = ['ack','ack','ack','noise','noise','noise','ack','short','ack','ack','transient','transient','transient','transient','transient','restate','restate','restate','restate','trivial'];
const good = [ 'We deploy the billing API with blue-green releases because downtime breaks invoicing', 'Postgres 16 runs reporting; the read replica lags up to 30 seconds',
  'Never run the migration script on Fridays; the backup window starts at 22:00', 'The flaky upload test fails when two workers share the temp directory',
  'The mobile lead owns the mobile release checklist and signs off every store submission', 'Use pnpm, not npm, in the web repository; the lockfile is pnpm-lock.yaml',
  'Customer exports must stay in the EU region per the data processing agreement', 'The search index is rebuilt nightly at 01:00 UTC and takes about 40 minutes',
  'Prefer short commit messages in the first person', 'API tokens rotate every 90 days; the rotation job lives in infra/cron',
  'Login errors on Safari came from a third-party cookie block, fixed by same-site cookies', 'We chose Tailscale over a public tunnel for the staging dashboard',
  'The invoice PDF template is owned by finance; changes need their review', 'Load tests showed the queue worker saturates at 400 jobs per second',
  'Docs are written in British English' ];
const res = { junk: { n: junk.length, refused: 0, dated: 0, flagged: 0, saved_clean: 0, by_class: {} }, good: { n: good.length, refused: 0, dated: 0, flagged: 0, saved_clean: 0 } };
junk.forEach((t, i) => { const a = assess(t, {}); const k = a.verdict === 'refuse' ? 'refused' : a.review_by ? 'dated' : a.flags.length ? 'flagged' : 'saved_clean'; res.junk[k]++; const c = res.junk.by_class[junkClass[i]] ||= {}; c[k] = (c[k] || 0) + 1; });
good.forEach((t) => { const a = assess(t, {}); const k = a.verdict === 'refuse' ? 'refused' : a.review_by ? 'dated' : a.flags.length ? 'flagged' : 'saved_clean'; res.good[k]++; });
out.m3_gate_labelled = res;
// M3c restating the north star, verbatim and reworded
const root3 = fs.mkdtempSync(path.join(BASE, 'm3-')); initVault(path.join(root3, 'v'), {}); const v3 = new Vault(path.join(root3, 'v'), { git: false, fsync: false, keyDir: path.join(root3, 'k') }).open();
const facts = ['I work in Zurich and write mostly TypeScript and Rust', 'I prefer short answers with the code first', 'My main project is the billing platform for small shops', 'I review pull requests every morning before standup', 'I use Claude Code and Codex side by side'];
v3.write(ID, { path: 'memory/north-star.md', body: `# North star\n\n${facts.map((f) => `## ${f.split(' ').slice(0, 3).join(' ')}\n${f}`).join('\n\n')}\n` });
const verb = facts.map((f) => v3.remember(ID, { text: f, kind: 'preference' }));
const reword = facts.map((f) => v3.remember(ID, { text: `The user says: ${f.toLowerCase()}.`, kind: 'preference' }));
out.m3c_restatement = { verbatim: { n: 5, caught_as_duplicate: verb.filter((r) => r.duplicate).length }, reworded: { n: 5, caught_as_duplicate: reword.filter((r) => r.duplicate).length, flagged_similar: reword.filter((r) => r.flags?.includes('similar')).length } };
v3.close(); fs.rmSync(root3, { recursive: true, force: true });
// M5 graph canary
const root5 = fs.mkdtempSync(path.join(BASE, 'm5-')); initVault(path.join(root5, 'v'), {}); const v5 = new Vault(path.join(root5, 'v'), { git: false, fsync: false, keyDir: path.join(root5, 'k') }).open();
const canaries = Array.from({ length: 20 }, (_, i) => `Canary Person${String.fromCharCode(65 + i)}`);
canaries.forEach((c, i) => v5.write(ID, { path: `dept/hr/c${i}.md`, body: `# Case\n${c} raised an issue about \`shared-tool-${i % 4}\`.\n` }));
for (let i = 0; i < 4; i++) v5.write(ID, { path: `dept/eng/p${i}.md`, body: `# Plan\nThe \`shared-tool-${i}\` change ships with Release Train.\n` });
const eng = { id: 'e', agent: 'e', scopes: ['read'], paths: ['dept/eng/**'] };
let before = 0, after = 0;
for (let i = 0; i < 4; i++) { const nb0 = v5.graph.neighbours(`shared-tool-${i}`, 50); before += nb0.filter((n) => /Canary/.test(n.name)).length; const nb1 = v5.graph.neighbours(`shared-tool-${i}`, 50, v5.graphView(eng)); after += nb1.filter((n) => /Canary/.test(n.name)).length; }
out.m5_graph_canary = { canary_names: 20, leaked_without_view: before, leaked_with_view: after };
v5.close(); fs.rmSync(root5, { recursive: true, force: true });
fs.rmSync(BASE, { recursive: true, force: true });
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
if (jsonOut) fs.writeFileSync(jsonOut, `${JSON.stringify(out, null, 1)}\n`);
console.log(JSON.stringify(out, null, 1));
// the lab targets (docs/testing/LAB-TEST-PLAN.md); exit 1 if one is missed
const g = out.m3_gate_labelled;
const checks = {
  'non-Latin recall@1 is 26/26': out.m1_tokenizer.total === 26 && out.m1_tokenizer.new_recall_at_1 === 26,
  'gate: 15 of 20 junk refused or dated': g.junk.refused + g.junk.dated === 15,
  'gate: 0 of 15 good refused, dated or flagged': g.good.refused + g.good.dated + g.good.flagged === 0,
  'project scope: no hits from other projects': out.m2_project_bleed.hard_scope.from_other_projects === 0 && out.m2b_cross_vocabulary.hard_scope.from_other_projects === 0,
  'why: every explanation multiplies back to its score': out.m4_explain.explanation_equals_score === out.m4_explain.items_checked,
  'graph: no restricted names through a path-limited view': out.m5_graph_canary.leaked_with_view === 0,
};
for (const [k, ok] of Object.entries(checks)) console.error(`${ok ? 'PASS' : 'FAIL'}  ${k}`);
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
