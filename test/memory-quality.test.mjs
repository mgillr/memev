// Memory quality, Unicode recall, hard project scope, recall explanations, the review inbox and the
// graph's path limits.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Vault } from '../src/engine/vault.mjs';
import { tokenize, RecallIndex } from '../src/engine/index.mjs';
import { ROW, C_PATH, C_LEN, SEG_VERSION } from '../src/engine/segment.mjs';
import { assess } from '../src/engine/quality.mjs';
import { handle } from '../src/server/mcp.mjs';
import { newVault, cleanup, OWNER } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
after(cleanup);

// the tokenizer before Unicode support, kept here to prove ASCII text indexes exactly as before
const STOP = new Set('a an and are as at be but by for from has have i if in into is it its of on or our so that the their them then there these they this to was we were what when where which who will with you your not no do does did can could should would just also than too very about after before over under more most some such only own same each other any all both few'.split(' '));
const oldTokenize = (text) => String(text || '').toLowerCase().normalize('NFKD').split(/[^a-z0-9_.-]+/).map((t) => t.replace(/^[.-]+|[.-]+$/g, '')).filter((t) => t.length >= 2 && t.length <= 40 && !STOP.has(t));

test('ASCII text tokenizes exactly as before', () => {
  for (const s of ['Deploy the API with docker-compose.yml on port 8080', 'v1.2.3 -- foo_bar ...baz.. A b cd', '# Heading\n- [x] done item\nProject: billing', '']) assert.deepEqual(tokenize(s), oldTokenize(s), s);
});

test('Chinese, Japanese, Korean, Cyrillic, Greek, Arabic and accented Latin are indexed and recalled', () => {
  const { v } = newVault();
  const notes = {
    zh: ['我们决定用东京的服务器部署数据库', '东京'],
    ja: ['本番環境のデプロイは金曜日に禁止です', 'デプロイ'],
    ko: ['배포는 금요일에 하지 않는다', '배포'],
    ru: ['Мы используем Postgres 16 для отчётов', 'отчётов'],
    el: ['Η βάση δεδομένων τρέχει στην Αθήνα', 'δεδομένων'],
    ar: ['قاعدة البيانات تعمل على الخادم الرئيسي', 'البيانات'],
    fr: ['Le café naïve est fermé le lundi', 'naive cafe'],
  };
  for (const [k, [text]] of Object.entries(notes)) v.write(OWNER, { path: `notes/${k}.md`, body: `# ${k}\n${text}\n` });
  for (const [k, [, q]] of Object.entries(notes)) assert.equal(v.recall(OWNER, { query: q, log: false })[0]?.path, `notes/${k}.md`, `${k}: ${q}`);
  assert.equal(v.recall(OWNER, { query: '東京', log: false })[0]?.path, 'notes/zh.md', 'a Japanese spelling of the same Han characters still matches');
  v.close();
});

// The same promise as when the index was one file, on the segment: a rebuild gives the sections, words and counts the note by note index holds, and rebuilding twice gives the same bytes.
test('a rebuilt index is byte-identical to the one built note by note, and an old index is rebuilt', () => {
  const { root, v } = newVault();
  v.remember(OWNER, { text: '数据库迁移在周五之前完成，不要在周末部署', kind: 'decision', project: 'infra' });
  v.remember(OWNER, { text: 'Миграция базы данных завершена до пятницы', kind: 'fact', project: 'infra' });
  v.append(OWNER, { path: 'notes/log.md', text: '# Day one\nWe chose Ελληνικά labels for the dashboard' });
  v.append(OWNER, { path: 'notes/log.md', text: '## Day two\nRetry the 東京 deploy after the freeze' });
  v.index.dirty = true; v.index.save(); v.index.compact();
  const dump = (index) => {
    const seg = index.seg, c = seg.cols(), words = Array.from({ length: seg.head.n }, () => []);
    for (const l of fs.readFileSync(path.join(seg.dir, 'dict.txt'), 'utf8').split('\n')) { if (!l) continue; const [w, df, row] = l.split('\t'); const e = { df: Number(df), row: Number(row) }; const ids = seg.ids(e), tfs = seg.tfs(e); for (let k = 0; k < e.df; k++) words[ids[k]].push([w, tfs[k]]); }
    const out = []; for (let i = 0; i < seg.head.n; i++) { const m = seg.meta(i); out.push(JSON.stringify({ path: seg.paths[c[i * ROW + C_PATH] - 1], heading: seg.heading(i), line: m.line, len: c[i * ROW + C_LEN], rb: seg.rb(i), snippet: m.snippet, fl: m.fl, words: words[i] })); }
    return out.sort().join('\n');
  };
  const files = (index) => Object.fromEntries(fs.readdirSync(index.seg.dir).filter((f) => f !== 'overlay.log').map((f) => [f, fs.readFileSync(path.join(index.seg.dir, f)).toString('base64')]));
  const incremental = dump(v.index);
  assert.match(incremental, /Ελληνικά|ελληνικά/i, 'the dump has the words');
  v.close();
  const v2 = new Vault(root, { git: false, fsync: false }).open(); v2.index.reset(); v2.reindexAll();
  assert.equal(dump(v2.index), incremental, 'same sections, words and counts');
  const once = files(v2.index); assert.ok(Object.keys(once).length >= 8, 'every file of the segment is compared');
  v2.index.reset(); v2.reindexAll(); assert.deepEqual(files(v2.index), once, 'rebuilding twice gives the same bytes');
  v2.close();
  // a segment of another version is not trusted, and neither is an old file of an old version
  const indexDir = path.join(root, '.memev', 'index.seg');
  const gen = fs.readFileSync(path.join(indexDir, 'CURRENT'), 'utf8'); const headFile = path.join(indexDir, `gen-${gen}`, 'head.json');
  fs.writeFileSync(headFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(headFile, 'utf8')), version: SEG_VERSION - 1 }));
  const v3 = new Vault(root, { git: false, fsync: false }).open();
  assert.equal(v3.recall(OWNER, { query: '数据库', log: false })[0]?.path.startsWith('memory/decisions/'), true, 'reindexed on open');
  v3.close();
  fs.rmSync(indexDir, { recursive: true, force: true });
  fs.writeFileSync(path.join(root, '.memev', 'index.jsonl'), '{"version":2,"sections":0}\n');
  assert.equal(new RecallIndex(path.join(root, '.memev', 'index.jsonl')).load(), false, 'a version 2 index is not trusted');
  const v4 = new Vault(root, { git: false, fsync: false }).open();
  assert.equal(v4.recall(OWNER, { query: '数据库', log: false })[0]?.path.startsWith('memory/decisions/'), true, 'reindexed on open');
  v4.close();
});

test('the write gate refuses acknowledgements, noise, fragments and duplicates, and says why', () => {
  const { v } = newVault();
  for (const t of ['ok thanks', 'Done.', 'heartbeat ok', 'NO_REPLY', 'use tabs']) { const r = v.remember(OWNER, { text: t }); assert.equal(r.saved, false, t); assert.equal(r.refused, true, t); assert.ok(r.reasons[0].length > 5); }
  const first = v.remember(OWNER, { text: 'We deploy the billing API with blue-green releases behind the load balancer', kind: 'decision', why: 'zero downtime' });
  assert.equal(first.saved, true);
  const again = v.remember(OWNER, { text: 'We deploy the billing API with blue-green releases behind the load balancer', kind: 'fact' });
  assert.equal(again.duplicate, true, 'a duplicate is caught across kinds');
  const forced = v.remember(OWNER, { text: 'use tabs', force: true });
  assert.equal(forced.saved, true); assert.deepEqual(forced.flags, ['forced']);
  assert.equal(assess('Maybe the cache layer is the cause of the slow login', {}).flags.includes('uncertain'), true);
  v.close();
});

test('short-lived memories get a review date, leave recall after it, and come back when kept', () => {
  const { root, v } = newVault();
  const r = v.remember(OWNER, { text: 'For now the staging database is read only while we debug replication', kind: 'gotcha' });
  assert.ok(r.review_by && r.flags.includes('short-lived'));
  assert.equal(v.recall(OWNER, { query: 'staging database read only', log: false }).length, 1, 'recalled before its date');
  const past = v.remember(OWNER, { text: 'The demo laptop password rotation happens on the shared tablet', kind: 'fact', review_by: '2020-01-01' });
  assert.equal(past.review_by, '2020-01-01');
  assert.equal(v.recall(OWNER, { query: 'demo laptop rotation tablet', log: false }).length, 0, 'past its date: out of recall');
  const item = `${past.path}#${past.heading}`;
  assert.ok(v.reviewInbox(OWNER).some((x) => x.item === item && x.expired), 'waiting in the review inbox');
  v.review(OWNER, { action: 'keep', items: [item] });
  assert.equal(v.recall(OWNER, { query: 'demo laptop rotation tablet', log: false }).length, 1, 'kept: back in recall');
  assert.equal(v.reviewInbox(OWNER).some((x) => x.item === item), false);
  const other = `${r.path}#${r.heading}`;
  v.review(OWNER, { action: 'drop', items: [other] });
  assert.equal(v.recall(OWNER, { query: 'staging database read only', log: false }).length, 0, 'dropped: out of recall');
  assert.ok(fs.readFileSync(path.join(root, r.path), 'utf8').includes('staging database'), 'the note itself is not edited');
  v.close();
  const v2 = new Vault(root, { git: false, fsync: false }).open();
  assert.equal(v2.recall(OWNER, { query: 'staging database read only', log: false }).length, 0, 'review decisions survive a restart');
  assert.equal(v2.recall(OWNER, { query: 'demo laptop rotation tablet', log: false }).length, 1);
  v2.close();
});

test('memev audit reports junk without changing anything', () => {
  const { root, v } = newVault();
  v.remember(OWNER, { text: 'The invoice export runs nightly at two and writes CSV to the reports bucket', kind: 'fact' });
  v.remember(OWNER, { text: 'ok thanks', force: true });
  v.remember(OWNER, { text: 'Probably the flaky test is caused by the shared cache directory', kind: 'gotcha' });
  v.remember(OWNER, { text: 'Old sprint goal for the onboarding flow redesign', kind: 'note', review_by: '2020-01-01' });
  // a duplicate written by hand, past the gate
  v.append(OWNER, { path: 'memory/facts/2020-01.md', text: '# Facts 2020-01\n\n### 2020-01-02 10:00Z · editor\nThe invoice export runs nightly at two and writes CSV to the reports bucket\n' });
  const before = fs.readFileSync(path.join(root, 'memory/facts/2020-01.md'));
  const a = v.audit(OWNER);
  assert.equal(a.counts.refused_now, 1); assert.equal(a.counts.duplicates, 1); assert.equal(a.counts.expired, 1); assert.equal(a.counts.uncertain, 1);
  assert.equal(a.likely_junk, 3); assert.ok(a.junk_share > 0.5 && a.junk_share < 0.7);
  assert.ok(fs.readFileSync(path.join(root, 'memory/facts/2020-01.md')).equals(before));
  v.close();
});

test('recall with a project stays inside it; other projects only with all_projects', () => {
  const { v } = newVault();
  v.remember(OWNER, { text: 'Deploy freeze on Fridays for the billing service releases', kind: 'decision', project: 'billing' });
  v.remember(OWNER, { text: 'Deploy previews run on every pull request in the mobile app', kind: 'decision', project: 'mobile-app' });
  v.remember(OWNER, { text: 'Deploy notifications go to the team channel, whatever the project', kind: 'preference' });
  v.checkpoint(OWNER, { project: 'Mobile App', task: 'deploy pipeline', done: ['deploy previews'] });
  const q = (o) => v.recall(OWNER, { query: 'deploy', log: false, limit: 10, ...o }).map((h) => h.project || 'none');
  const scoped = q({ project: 'billing' });
  assert.ok(scoped.includes('billing') && scoped.includes('none'));
  assert.equal(scoped.some((p) => p.startsWith('mobile')), false, 'no other project leaks in');
  const all = q({ project: 'billing', all_projects: true });
  assert.ok(all.some((p) => p.startsWith('mobile')), 'all_projects searches everything');
  assert.equal(all[0], 'billing', 'and still ranks the project first');
  assert.ok(q({ project: 'Mobile App' }).filter((p) => p !== 'none').every((p) => p === 'mobile-app' || p === 'mobile app'), 'project names match by slug');
  v.close();
});

test('why: the explanation multiplies back to the recall score and says why an item was left out', async () => {
  const { v } = newVault();
  v.remember(OWNER, { text: 'Postgres 16 runs the billing database with logical replication', kind: 'decision', project: 'billing' });
  v.remember(OWNER, { text: 'Postgres connection pool size is twenty for the search workers', kind: 'fact', project: 'search' });
  const hits = v.recall(OWNER, { query: 'postgres replication', project: 'billing', log: false });
  const w = v.why(OWNER, { query: 'postgres replication', project: 'billing' });
  assert.equal(w.items[0].item, `${hits[0].path}#${hits[0].heading}`);
  assert.equal(w.items[0].score, hits[0].score, 'same score as recall');
  const sum = w.items[0].explanation.words.reduce((a, x) => a + x.contribution, 0) * w.items[0].explanation.project_multiplier * w.items[0].explanation.feedback_multiplier;
  assert.ok(Math.abs(sum - hits[0].score) < 0.01, 'the parts add up');
  assert.match(w.items[0].why.join(' '), /"replication"/);
  const search = v.recall(OWNER, { query: 'postgres pool', project: 'search', log: false })[0];
  const out = v.why(OWNER, { query: 'postgres pool', project: 'billing', path: search.path, heading: search.heading });
  assert.equal(out.items[0].recalled, false); assert.match(out.items[0].why[0], /belongs to project search/);
  assert.ok(out.provenance.written_total >= 1);
  const r = await handle(v, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memev_why', arguments: { query: 'postgres replication', project: 'billing' } } }, { identity: OWNER, client: 't', local: true });
  assert.equal(r.result.isError, undefined); assert.equal(r.result.structuredContent.items[0].score, hits[0].score);
  for (const name of ['memev_review', 'memev_audit']) { const x = await handle(v, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: {} } }, { identity: OWNER, client: 't', local: true }); assert.equal(x.result.isError, undefined, name); }
  v.close();
});

test('a token limited to some paths sees only the graph of the notes it may read', async () => {
  const { v } = newVault();
  v.write(OWNER, { path: 'dept/hr/case.md', body: '# Case\nProject Nightingale involves Dana Whitfield and the `payroll-fix` change.\n' });
  v.write(OWNER, { path: 'dept/eng/plan.md', body: '# Plan\nThe `payroll-fix` change ships with Release Train.\n' });
  const eng = { id: 'e', agent: 'eng', scopes: ['read'], paths: ['dept/eng/**'] };
  const call = async (identity, name, args) => (await handle(v, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { identity, client: 't', local: true })).result.structuredContent;
  const ownerView = await call(OWNER, 'memev_graph', { entity: 'payroll-fix' });
  assert.ok(ownerView.neighbours.some((n) => n.name === 'Dana Whitfield'), 'the owner sees the HR note');
  const engView = await call(eng, 'memev_graph', { entity: 'payroll-fix' });
  assert.equal(engView.neighbours.some((n) => /dana|nightingale/i.test(n.name)), false, 'no names from the HR note');
  assert.ok(engView.neighbours.some((n) => n.name === 'Release Train'));
  assert.equal((await call(eng, 'memev_graph', { entity: 'Dana Whitfield' })).neighbours.length, 0);
  assert.equal((await call(eng, 'memev_explain', { from: 'Release Train', to: 'Dana Whitfield' })).found, false);
  assert.equal(v.recall(eng, { query: 'Nightingale payroll', log: false }).some((h) => h.path.startsWith('dept/hr/')), false);
  v.close();
});

test('memev init --org starts with remote access off; cloud on asks for --yes', () => {
  const sb = sandbox();
  try {
    const r = sb.run(['init', '--org', '--no-connect', '--port', String(sb.port)]);
    assert.equal(r.code, 0, r.out + r.err);
    const cfg = JSON.parse(fs.readFileSync(path.join(sb.root, '.memev', 'config.json'), 'utf8'));
    assert.equal(cfg.remote.enabled, false); assert.equal(cfg.profile, 'org');
    assert.match(r.out, /organisation install/);
    const on = sb.run(['cloud', 'on']);
    assert.equal(on.code, 1); assert.match(on.out, /--yes/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(sb.root, '.memev', 'config.json'), 'utf8')).remote.enabled, false);
  } finally { sb.stop(); }
});
