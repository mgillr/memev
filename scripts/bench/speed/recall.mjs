// SPDX-License-Identifier: Apache-2.0
// Recall on the segment index against the oracle, the in-memory RecallIndex, with the options the real route passes:
// the real filter, a project, tuning boosts, reviews, a token limited to some paths. Exits non-zero when an answer
// differs in any state, or when a deliberately broken index is not caught.
//   node scripts/bench/speed/recall.mjs --index <a copy of .memev/index.jsonl> --work <scratch folder> [--writes 300] [--prompts 120] [--states fresh,writes,reload,fold,midfold] [--no-oracle-latency]
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { RecallIndex } from '../../../src/engine/index.mjs';
import { SegIndex } from '../../../src/engine/segment-index.mjs';
import { Vault } from '../../../src/engine/vault.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const INDEX = arg('index'); const WORK = arg('work'); const WRITES = Number(arg('writes', 300)); const MAXP = Number(arg('prompts', 120)); const STATES = arg('states', 'fresh,writes,reload,fold,midfold').split(',');
const stat = (a) => { const s = [...a].sort((x, y) => x - y); const q = (p) => Number(s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))].toFixed(2)); return { n: s.length, p50: q(0.5), p95: q(0.95), max: q(1) }; };
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const report = { index: path.basename(INDEX || ''), states: {}, controls: {} };

const orc = new RecallIndex(INDEX); if (!orc.load()) throw new Error('the oracle index did not load');
const docsAll = [...orc.docs.values()];
// Prompts as the growth rig's exp1 and exp3 make them: the labelled set, the off-topic set, and text cut from sections.
const Q = JSON.parse(fs.readFileSync(path.join(REPO, 'bench/queries.json'), 'utf8'));
const cut = (seed, n) => { const rnd = rng(seed); const out = []; for (let i = 0; i < n; i++) { const d = docsAll[Math.floor(rnd() * docsAll.length)]; const w = (d.snippet || '').split(/\s+/); const m = 6 + Math.floor(rnd() * 60); const at = Math.floor(rnd() * Math.max(1, w.length - m)); out.push({ p: w.slice(at, at + m).join(' '), proj: null }); } return out; };
const prompts = [...Q.on_topic.map((q) => ({ p: q.prompt, proj: q.project })), ...Q.off_topic.map((q) => ({ p: q.prompt, proj: null })), ...cut(12345, MAXP), ...cut(987, MAXP >> 1)];

// Tuning and reviews in the shape the vault keeps them, on real keys.
const rb = rng(7); const key = (d) => `${d.path}#${d.heading || ''}`; const boosts = {}; for (let i = 0; i < 500; i++) boosts[key(docsAll[Math.floor(rb() * docsAll.length)])] = Number((0.3 + rb() * 1.7).toFixed(3));
const reviews = new Map(); for (let i = 0; i < 50; i++) reviews.set(key(docsAll[Math.floor(rb() * docsAll.length)]), i % 2 ? { action: 'drop' } : { action: 'keep', until: '2020-01-01' });
const filterOf = (revs) => (identity, o) => Vault.prototype._recallFilter.call({ reviews: revs, config: { recall: { scope: 'project' } } }, identity, o);
const none = filterOf(new Map()), withRev = filterOf(reviews); const open = { paths: ['**'], scopes: ['read'] }, limited = { paths: ['notes/**', 'memory/**'], scopes: ['read'] };
const CONFIGS = {
  route: (x) => ({ limit: 4, project: x.proj, boosts: {}, filter: none(open, { project: x.proj }) }),
  tuned: (x) => ({ limit: 6, project: x.proj, boosts, filter: withRev(open, { project: x.proj }) }),
  limited: (x) => ({ limit: 6, project: x.proj || 'billing', boosts, filter: withRev(limited, { project: x.proj || 'billing' }) }),
  wide: (x) => ({ limit: 10, project: x.proj || 'billing', boosts: null, filter: none(open, { project: x.proj || 'billing', all_projects: true }) }),
  remember: () => ({ limit: 5, prefix: 'memory/', filter: (d) => reviews.get(key(d))?.action !== 'drop' }),
  hook: (x) => ({ limit: 4, project: x.proj, boosts: {}, filter: none(open, { project: x.proj, dropPath: (p) => p.startsWith('work/sessions/') || p.startsWith('contracts/drafts/') }) }),
  bare: () => ({ limit: 60 }),
};
const show = (r) => JSON.stringify(r) + r.total;

export function compare(ix, label, list = prompts, { latency = true } = {}) {
  const out = { compared: 0, differ: 0, first: null, latency: {} };
  for (const [name, mk] of Object.entries(CONFIGS)) {
    const ta = [], tb = [];
    for (const x of list) {
      const t0 = performance.now(); const a = orc.query(x.p, mk(x)); const t1 = performance.now(); const b = ix.query(x.p, mk(x)); const t2 = performance.now(); ta.push(t1 - t0); tb.push(t2 - t1); out.compared++;
      if (show(a) !== show(b)) { out.differ++; if (!out.first) out.first = { config: name, p: x.p.slice(0, 60), a: a.slice(0, 2).map((h) => [h.path, h.line, h.score]), b: b.slice(0, 2).map((h) => [h.path, h.line, h.score]), ta: a.total, tb: b.total }; }
      else if (a.length) { const h = a[0]; const da = orc.docsOf(h.path, h.heading || '').find((d) => d.line === h.line); const db = ix.docsOf(h.path, h.heading || '').find((d) => d.line === h.line); const ea = JSON.stringify(orc.explain(x.p, da, { project: x.proj, boosts })); const eb = db ? JSON.stringify(ix.explain(x.p, db, { project: x.proj, boosts })) : 'missing'; out.compared++; if (ea !== eb) { out.differ++; if (!out.first) out.first = { config: `${name}/explain`, p: x.p.slice(0, 60), ea: ea.slice(0, 200), eb: eb.slice(0, 200) }; } }
    }
    if (latency) out.latency[name] = { oracle: stat(ta), seg: stat(tb) };
  }
  if (orc.docs.size !== ix.docs.size) { out.differ++; out.sections = [orc.docs.size, ix.docs.size]; }
  if (orc.stats().notes !== ix.stats().notes) { out.differ++; out.notes = [orc.stats().notes, ix.stats().notes]; }
  report.states[label] = out; console.log(JSON.stringify({ state: label, compared: out.compared, differ: out.differ, first: out.first, sections: orc.docs.size, latency: out.latency }));
  return out;
}

const paths = [...orc.byPath.keys()]; let wseed = 4242; let wi = 0;
function writes(ix, n) {
  const rnd = rng(wseed); wseed += 1; const textFor = (i) => { const d = docsAll[Math.floor(rnd() * docsAll.length)]; return `# rewritten ${i}\n\nProject: billing\n\n## new section r${i}\n${d.snippet}\n\n## another r${i}\nunique${i} ${(docsAll[Math.floor(rnd() * docsAll.length)].snippet || '').slice(0, 200)}\n`; };
  for (let k = 0; k < n; k++) {
    const i = wi++; const r = rnd(); const p = paths[Math.floor(rnd() * paths.length)];
    if (r < 0.45) { const b = textFor(i); orc.update(p, b, { mtime: 1 }); ix.update(p, b, { mtime: 1 }); }
    else if (r < 0.6) { const q = `notes/new/n${i}.md`; const b = textFor(i); orc.update(q, b, { mtime: 2 }); ix.update(q, b, { mtime: 2 }); paths.push(q); }
    else if (r < 0.9) { const t = `## appended ${i}\nappended words unique${i} ${(docsAll[Math.floor(rnd() * docsAll.length)].snippet || '').slice(0, 120)}\n`; orc.appendSections(p, t, { lineOffset: 100 + i, mtime: 3 }); ix.appendSections(p, t, { lineOffset: 100 + i, mtime: 3 }); }
    else { orc.remove(p); ix.remove(p); }
  }
}

setInterval(() => {}, 1000); // a fold's worker does not hold the process open
fs.mkdirSync(WORK, { recursive: true }); const file = path.join(WORK, 'index.jsonl');
let t = performance.now();
if (!fs.existsSync(path.join(WORK, 'index.seg', 'CURRENT'))) { fs.copyFileSync(INDEX, file); const c = new SegIndex(file); if (!c.load()) throw new Error('conversion failed'); report.convert_ms = Math.round(performance.now() - t); }
fs.rmSync(path.join(WORK, 'index.overlay.jsonl'), { force: true }); fs.rmSync(path.join(WORK, 'index.retired.json'), { force: true });
let ix = new SegIndex(file); if (!ix.load()) throw new Error('segment did not load');
let bad = 0;
if (STATES.includes('fresh')) bad += compare(ix, 'fresh').differ;
if (STATES.includes('writes')) { writes(ix, WRITES); bad += compare(ix, 'writes').differ; }
if (STATES.includes('reload')) { ix.dirty = true; ix.save(); if (ix.foldP) await ix.foldP; const again = new SegIndex(file); again.load(); ix = again; bad += compare(ix, 'reload').differ; }
if (STATES.includes('fold')) { writes(ix, 50); t = performance.now(); ix.dirty = true; ix.save(); if (!ix.foldP) ix.foldSoon(); await ix.foldP; report.fold_ms = Math.round(performance.now() - t); bad += compare(ix, 'fold').differ; }
if (STATES.includes('midfold')) { writes(ix, 50); ix.dirty = true; ix.save(); if (!ix.foldP) ix.foldSoon(); const p = ix.foldP; for (let i = 0; i < 6; i++) { writes(ix, 20); await new Promise((r) => setTimeout(r, 40)); } await p; bad += compare(ix, 'midfold').differ; const again = new SegIndex(file); ix.dirty = true; ix.save(); again.load(); bad += compare(again, 'midfold-reload', prompts.slice(0, 60), { latency: false }).differ; }

// Broken controls: each must fail the comparison, or this comparison proves nothing.
const shift = Object.create(ix); shift.query = function (q, o) { const r = ix.query(q, o); if (r.length > 1) { const [a, b] = [r[0], r[1]]; r[0] = b; r[1] = a; } return r; };
const noBoost = Object.create(ix); noBoost.query = function (q, o) { return ix.query(q, { ...o, boosts: null }); };
const noReview = Object.create(ix); noReview.query = function (q, o) { return ix.query(q, { ...o, filter: o.prefix ? null : o.filter && ((d) => { const f = none(open, { project: o.project }); return f(d); }) }); };
const list = prompts.slice(0, 80);
for (const [name, c] of Object.entries({ order: shift, boost: noBoost, review: noReview })) { const r = compare(c, `control-${name}`, list, { latency: false }); report.controls[name] = r.differ; if (!r.differ) { console.log(`the broken control ${name} was not caught`); bad++; } }
console.log(JSON.stringify({ result: bad ? 'FAIL' : 'PASS', differences: bad, controls: report.controls, convert_ms: report.convert_ms, fold_ms: report.fold_ms }));
if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify(report, null, 1));
process.exit(bad ? 1 : 0);
