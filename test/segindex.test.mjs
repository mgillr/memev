// SPDX-License-Identifier: Apache-2.0
// The segment index against the oracle, the in-memory RecallIndex, with the options the recall route passes, and through
// the moments that can go wrong: a write during a fold, a kill during a fold, tuning and reviews on every scored section.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RecallIndex } from '../src/engine/index.mjs';
import { SegIndex } from '../src/engine/segindex.mjs';
import { Seg } from '../src/engine/seg2.mjs';
import { Vault, initVault } from '../src/engine/vault.mjs';

const HERE = fileURLToPath(import.meta.url);
// A fold's worker does not hold the process open, so a test waiting on one holds it.
const settle = async (p) => { const h = setInterval(() => {}, 50); try { await p; } finally { clearInterval(h); } };
const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'segindex-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const WORDS = 'webhook retries billing database migration timeout deploy staging rollback token rotation gateway cache eviction parser schema index shard replica backup restore audit ledger invoice'.split(' ');
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
function note(r, i) { const w = () => WORDS[Math.floor(r() * WORDS.length)]; const s = []; for (let k = 0; k < 3; k++) { const words = []; for (let j = 0, n = 8 + Math.floor(r() * 30); j < n; j++) words.push(w()); s.push(`${k === 2 && i % 5 === 0 ? '#  ' : `## sec ${i % 7} ${k}`}\n${k === 1 ? `Project: ${['billing', 'ops', 'Search'][i % 3]}\n` : ''}${i % 11 === 0 && k === 0 ? 'review-by: 2020-02-03\n' : ''}${i % 13 === 0 && k === 0 ? 'flags: unsure\n' : ''}${words.join(' ')} uniq${i % 40}`); } return `intro words ${w()} ${w()}\n\n${s.join('\n\n')}\n`; }
const notePath = (i) => (i % 4 === 0 ? `memory/m${i}.md` : i % 4 === 1 ? `work/sessions/s${i}.md` : i % 17 === 2 ? `work/active/p${i}.md` : `notes/n${i}.md`);
function seeded(dir, count = 900) { const orc = new RecallIndex(path.join(dir, 'oracle.jsonl')); const r = rng(5); for (let i = 0; i < count; i++) orc.update(notePath(i), note(r, i), { mtime: i }); const file = path.join(dir, 'index.jsonl'); orc.file = file; orc.dirty = true; orc.save(); const ix = new SegIndex(file); assert.equal(ix.load(), true); return { orc, ix, file }; }
const open = { paths: ['**'], scopes: ['read'] }, limited = { paths: ['notes/**', 'memory/**'], scopes: ['read'] };
const filterOf = (reviews) => (identity, o) => Vault.prototype._recallFilter.call({ reviews, config: { recall: { scope: 'project' } } }, identity, o);
const PROMPTS = ['webhook retries billing', 'database migration timeout deploy', 'uniq3 token', 'rollback uniq7 gateway cache', 'parser schema', 'invoice ledger audit uniq12', 'nothing matches zzzz', 'sec 3'];
function agree(orc, ix, label) {
  assert.equal(ix.docs.size, orc.docs.size, `${label}: sections`); assert.equal(ix.stats().notes, orc.stats().notes, `${label}: notes`);
  const keys = [...orc.docs.values()].filter((_, i) => i % 37 === 0).map((d) => `${d.path}#${d.heading || ''}`); const boosts = Object.fromEntries(keys.map((k, i) => [k, 0.3 + (i % 18) / 10])); const reviews = new Map(keys.filter((_, i) => i % 3 === 0).map((k, i) => [k, i % 2 ? { action: 'drop' } : { action: 'keep', until: '2020-01-01' }])); const none = filterOf(new Map()), rev = filterOf(reviews);
  const configs = [(p) => ({ limit: 4, project: p, boosts: {}, filter: none(open, { project: p }) }), (p) => ({ limit: 6, project: p, boosts, filter: rev(open, { project: p }) }), (p) => ({ limit: 6, project: p, boosts, filter: rev(limited, { project: p }) }), (p) => ({ limit: 10, project: p, boosts: null, filter: none(open, { project: p, all_projects: true }) }), () => ({ limit: 5, prefix: 'memory/', filter: (d) => reviews.get(`${d.path}#${d.heading || ''}`)?.action !== 'drop' }), () => ({ limit: 200 })];
  let compared = 0;
  for (const q of PROMPTS) for (const p of [null, 'billing', 'search']) for (const c of configs) { const a = orc.query(q, c(p)), b = ix.query(q, c(p)); assert.equal(JSON.stringify(b), JSON.stringify(a), `${label}: ${q} ${p}`); assert.equal(b.total, a.total, `${label}: total of ${q}`); compared++; if (a.length) { const h = a[0]; const da = orc.docsOf(h.path, h.heading || '').find((d) => d.line === h.line), db = ix.docsOf(h.path, h.heading || '').find((d) => d.line === h.line); assert.ok(db, `${label}: section of a hit`); for (const f of ['path', 'heading', 'line', 'len', 'project', 'mtime', 'snippet', 'rb', 'fl']) assert.equal(db[f], da[f], `${label}: ${f}`); assert.deepEqual(ix.explain(q, db, { project: p, boosts }), orc.explain(q, da, { project: p, boosts }), `${label}: explain`); } }
  return compared;
}
function writes(orc, ix, seed, n, offset = 0) { const r = rng(seed); for (let k = 0; k < n; k++) { const i = offset + k; const p = notePath(Math.floor(r() * 900)); const x = r(); if (x < 0.35) { const b = note(r, 1000 + i); orc.update(p, b, { mtime: 5 }); ix.update(p, b, { mtime: 5 }); } else if (x < 0.5) { const q = `notes/new${i}.md`; const b = note(r, 2000 + i); orc.update(q, b, { mtime: 6 }); ix.update(q, b, { mtime: 6 }); } else if (x < 0.9) { const t = `## added ${i}\nappended text uniq${i % 40} ${WORDS[i % WORDS.length]}\n`; orc.appendSections(p, t, { lineOffset: 500 + i, mtime: 7 }); ix.appendSections(p, t, { lineOffset: 500 + i, mtime: 7 }); } else { orc.remove(p); ix.remove(p); } } }

// ---- kills. The child dies by SIGKILL at a named step; the parent reopens the files and compares with the oracle.
const kill = (at) => spawnSync(process.execPath, [HERE, '--child', at.dir, at.step], { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
if (process.argv[2] === '--child') {
  const [dir, step] = process.argv.slice(3); const file = path.join(dir, 'index.jsonl'); const ix = new SegIndex(file); ix.load(); const die = () => process.kill(process.pid, 'SIGKILL');
  const r = fs.renameSync; const seen = (x) => String(x).endsWith('CURRENT');
  if (step === 'before-publish') fs.renameSync = function (a, b) { if (seen(b)) die(); return r.call(fs, a, b); };
  if (step === 'after-publish') fs.renameSync = function (a, b) { const v = r.call(fs, a, b); if (seen(b)) die(); return v; };
  ix.appendSections('notes/sealed.md', '## sealed\nsealed text words\n', { lineOffset: 1, mtime: 1 }); ix.save();
  const f = ix.foldSoon(); ix.appendSections('notes/sealed.md', '## tail\ntail text words\n', { lineOffset: 3, mtime: 2 }); ix.save();
  if (step === 'mid-fold') { setTimeout(die, 0); } if (step === 'torn') { fs.appendFileSync(ix._log(ix.gen), '{"path":"notes/torn.md","head'); die(); }
  f.then(() => process.exit(0)); setInterval(() => {}, 1000); await new Promise(() => {});
}

test('answers match the oracle with the route options: fresh, after writes, reloaded, after a fold', async (t) => {
  const d = tmp(t); const { orc, ix, file } = seeded(d); assert.ok(agree(orc, ix, 'fresh') > 100); writes(orc, ix, 11, 60); agree(orc, ix, 'writes');
  ix.save(); const again = new SegIndex(file); assert.equal(again.load(), true); agree(orc, again, 'reloaded'); again.dirty = true; await settle(again.foldSoon()); assert.ok(again.gen > ix.gen, 'a new generation'); agree(orc, again, 'folded'); assert.equal(again.ov.docs.size, 0, 'nothing left in the overlay');
});

test('a broken index fails the same comparison', (t) => {
  const d = tmp(t); const { orc, ix } = seeded(d, 200); const swap = Object.create(ix); swap.query = (q, o) => { const r = ix.query(q, o); if (r.length > 1) [r[0], r[1]] = [r[1], r[0]]; return r; };
  assert.throws(() => agree(orc, swap, 'control'), /control/);
  const noBoost = Object.create(ix); noBoost.query = (q, o) => ix.query(q, { ...o, boosts: null }); assert.throws(() => agree(orc, noBoost, 'control'), /control/);
});

test('empty tuning, real tuning and reviews do not read a section per scored section', (t) => {
  const d = tmp(t); const { orc, ix } = seeded(d); let reads = 0; const m = Seg.prototype.meta; Seg.prototype.meta = function (i) { reads++; return m.call(this, i); }; t.after(() => { Seg.prototype.meta = m; });
  const keys = [...orc.docs.values()].slice(0, 40).map((x) => `${x.path}#${x.heading || ''}`); const reviews = new Map(keys.map((k) => [k, { action: 'drop' }])); const boosts = Object.fromEntries(keys.map((k) => [k, 1.5]));
  for (const [label, o] of [['empty tuning', { boosts: {}, filter: filterOf(new Map())(open, {}) }], ['tuning', { boosts, filter: filterOf(new Map())(open, {}) }], ['reviews', { boosts: {}, filter: filterOf(reviews)(open, {}) }]]) { reads = 0; const r = ix.query('webhook retries billing', { limit: 4, ...o }); assert.ok(r.total > 500, 'a query that scores many sections'); assert.ok(reads <= 4 * 2, `${label}: ${reads} section reads for ${r.total} scored sections`); }
});

test('equal scores keep the oracle order across the segment and the overlay', (t) => {
  // Two words in one section each, same length: one section is in the segment, the other only in the overlay. The word asked first is met first.
  const d = tmp(t); const orc = new RecallIndex(path.join(d, 'o.jsonl')); const same = (w) => `## h\n${w} padding padding padding\n`; orc.update('notes/stored.md', same('betaonly'), { mtime: 1 }); for (let i = 0; i < 5; i++) orc.update(`notes/f${i}.md`, `## f\nfiller ${i} other words\n`, { mtime: 1 }); const file = path.join(d, 'index.jsonl'); orc.file = file; orc.dirty = true; orc.save(); const ix = new SegIndex(file); ix.load();
  orc.update('notes/fresh.md', same('alphaonly'), { mtime: 1 }); ix.update('notes/fresh.md', same('alphaonly'), { mtime: 1 });
  const a = orc.query('alphaonly betaonly', { limit: 1 }), b = ix.query('alphaonly betaonly', { limit: 1 }); assert.equal(a[0].path, 'notes/fresh.md', 'the case is a real tie'); assert.equal(JSON.stringify(b), JSON.stringify(a));
});

test('headings: none, empty and repeated stay apart; review dates and flags survive without a read', (t) => {
  const d = tmp(t); const { orc, ix } = seeded(d, 120); const all = [...orc.docs.values()]; assert.ok(all.some((x) => x.heading === null) && all.some((x) => x.heading === '') && all.some((x) => x.rb) && all.some((x) => x.fl), 'the fixture has each kind');
  const segDocs = [...ix.docs.values()]; assert.equal(segDocs.length, all.length); all.forEach((x, i) => { for (const f of ['path', 'heading', 'line', 'len', 'project', 'mtime', 'snippet', 'rb', 'fl']) assert.equal(segDocs[i][f], x[f], `${f} of section ${i}`); });
});


test('a heading with half a surrogate pair comes back unchanged, and its review still applies', (t) => {
  const d = tmp(t); const orc = new RecallIndex(path.join(d, 'o.jsonl')); const body = '## bad \ud83d\nwords surrogate here\n'; orc.update('notes/s.md', body, { mtime: 1 }); for (let i = 0; i < 5; i++) orc.update(`notes/f${i}.md`, `## f\nfiller ${i}\n`, { mtime: 1 }); const file = path.join(d, 'index.jsonl'); orc.file = file; orc.dirty = true; orc.save(); const ix = new SegIndex(file); ix.load();
  assert.equal(ix.query('surrogate', { limit: 1 })[0].heading, 'bad \ud83d'); const reviews = new Map([['notes/s.md#bad \ud83d', { action: 'drop' }]]); assert.equal(ix.query('surrogate', { limit: 1, filter: filterOf(reviews)(open, {}) }).length, 0);
});

test('a save has the change in the file when it returns, and a flush follows', async (t) => {
  const d = tmp(t); const { ix, file } = seeded(d, 50); let flushes = 0; const f = fs.fdatasync; fs.fdatasync = function (...a) { flushes++; return f.apply(fs, a); }; t.after(() => { fs.fdatasync = f; });
  ix.update('notes/now.md', '## now\nsaved right now\n', { mtime: 1 }); ix.save(); assert.equal(flushes, 1, 'a flush was asked for'); const read = new SegIndex(file); assert.equal(read.load(), true); assert.equal(read.query('saved right now', { limit: 1 })[0].path, 'notes/now.md');
  await settle(new Promise((r) => setTimeout(r, 50)));
});

test('the log position waits for the flush, so it is never ahead of the index on the disk', async (t) => {
  const d = tmp(t); const { ix } = seeded(d, 50); const f = fs.fdatasync; let release = null; fs.fdatasync = function (fd, cb) { release = () => f.call(fs, fd, cb); }; t.after(() => { fs.fdatasync = f; }); let told = 0;
  ix.update('notes/p.md', '## p\nposition words\n', { mtime: 1 }); ix.save(); ix.whenSynced(() => { told++; }); assert.equal(told, 0, 'not before the flush'); assert.ok(release, 'a flush was asked for'); for (let k = 0; k < 3 && !told; k++) { release(); await settle(new Promise((r) => setTimeout(r, 60))); assert.ok(k > 0 || told <= 1); } assert.equal(told, 1, 'after the flush');
  let again = 0; fs.fdatasync = f; ix.whenSynced(() => { again++; }); assert.equal(again, 1, 'at once when nothing waits');
});

test('a line in the middle of the log that does not parse: the index asks to be rebuilt', (t) => {
  const d = tmp(t); const { ix, file } = seeded(d, 50); ix.update('notes/a.md', '## a\nwords\n', { mtime: 1 }); ix.save(); ix.update('notes/b.md', '## b\nwords\n', { mtime: 1 }); ix.save(); const log = ix._log(ix.gen); const text = fs.readFileSync(log, 'utf8'); fs.writeFileSync(log, `${text.slice(0, 40)}XXXX${text.slice(44)}`);
  const again = new SegIndex(file); assert.equal(again.load(), false);
});

test('the files of the index are private, as index.jsonl is', { skip: process.platform === 'win32' }, async (t) => {
  const d = tmp(t); const { orc, ix, file } = seeded(d, 60); writes(orc, ix, 61, 10); ix.save(); await settle(ix.foldSoon()); const base = `${file.replace(/\.jsonl$/, '')}.seg`; const walk = (p) => { const st = fs.statSync(p); assert.equal(st.mode & 0o077, 0, `${p} is private`); if (st.isDirectory()) for (const e of fs.readdirSync(p)) walk(path.join(p, e)); }; walk(base);
});

test('a note rewritten over and over folds on the size of the log', async (t) => {
  const d = tmp(t); const { ix } = seeded(d, 40); ix.logMax = 2000; const g = ix.gen; for (let i = 0; i < 20; i++) { ix.update('notes/same.md', `## same\nthe same note rewritten ${i}\n`, { mtime: i }); ix.save(); } assert.ok(ix.foldP, 'a fold started'); await settle(ix.foldP); assert.ok(ix.gen > g);
});

test('a word too common to count is not scanned after a write, and the answer stays the same', (t) => {
  // Needs a segment over the 2,000 sections where common words are dropped.
  const d = tmp(t); const orc = new RecallIndex(path.join(d, 'o.jsonl')); for (let i = 0; i < 2500; i++) orc.update(`notes/c${i}.md`, `## c\ncommonword ${i % 3 === 0 ? 'thirdword' : 'otherword'} fill${i % 50}\n`, { mtime: 1 }); const file = path.join(d, 'index.jsonl'); orc.file = file; orc.dirty = true; orc.save(); const ix = new SegIndex(file); ix.load(); for (const x of [orc, ix]) { x.remove('notes/c5.md'); x.update('notes/c6.md', '## c\ncommonword fill7 extra\n', { mtime: 2 }); }
  const ids = Seg.prototype.ids; const asked = new Set(); Seg.prototype.ids = function (e) { asked.add(e.df); return ids.call(this, e); }; t.after(() => { Seg.prototype.ids = ids; });
  for (const q of ['commonword fill7', 'commonword otherword', 'commonword', 'thirdword fill7', 'otherword commonword thirdword']) { const a = orc.query(q, { limit: 6 }), b = ix.query(q, { limit: 6 }); assert.equal(JSON.stringify(b), JSON.stringify(a), q); assert.equal(b.total, a.total, q); }
  asked.clear(); ix.query('commonword fill7', { limit: 6 }); assert.equal(asked.has(2500), false, 'the common word was not read');
  const h = orc.query('commonword fill7', { limit: 1 })[0]; const da = orc.docsOf(h.path, h.heading).find((x) => x.line === h.line), db = ix.docsOf(h.path, h.heading).find((x) => x.line === h.line); assert.deepEqual(ix.explain('commonword fill7', db), orc.explain('commonword fill7', da));
});

test('the debounced graph save does not wait for the disk on the thread that answers', async (t) => {
  const d = tmp(t); const root = path.join(d, 'v'); initVault(root, { template: path.join(path.dirname(HERE), '..', 'templates', 'vault') }); const v = new Vault(root, { git: false, fsync: false }).open(); const ID = { id: 'x', agent: 'x', scopes: ['read', 'write'], paths: ['**'] }; t.after(() => { try { v.close(); } catch { /* closed */ } });
  v.write(ID, { path: 'notes/g.md', body: '# g\n\n## one\nthe deploy pipeline and the Redis cache\n' }); const file = path.join(root, '.memev', 'graph.json'); const r = fs.renameSync; let syncOnGraph = 0; fs.renameSync = function (a, b) { if (String(b) === file) syncOnGraph++; return r.call(fs, a, b); }; t.after(() => { fs.renameSync = r; });
  const seq = v.log.seq; const before = fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0; await settle(new Promise((res) => setTimeout(res, 3400))); assert.equal(syncOnGraph, 0, 'no rename of graph.json on this thread'); assert.ok(fs.statSync(file).mtimeMs >= before); const snap = JSON.parse(fs.readFileSync(file, 'utf8')); assert.ok(snap.seq >= seq, 'the snapshot holds the log position'); if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o077, 0, 'private');
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((e) => e.endsWith('.tmp')), [], 'no temporary file left');
});

test('compact folds at once: the files shrink, nothing old is left, the answers stay', (t) => {
  const d = tmp(t); const { orc, ix, file } = seeded(d, 300); for (let i = 0; i < 200; i++) { const p = notePath(i); orc.remove(p); ix.remove(p); } writes(orc, ix, 71, 10, 900); ix.save(); const base = `${file.replace(/\.jsonl$/, '')}.seg`; const size = (p) => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).reduce((a, e) => a + size(path.join(p, e)), 0) : fs.statSync(p).size); const before = size(base); ix.compact(); assert.ok(size(base) < before, 'the files shrank'); assert.equal(fs.readdirSync(base).filter((e) => e.startsWith('gen-')).length, 1); agree(orc, ix, 'compacted'); const again = new SegIndex(file); assert.equal(again.load(), true); agree(orc, again, 'reloaded after compact');
});

test('an append under work/active in a subfolder inherits the stored project, as in the oracle', (t) => {
  const d = tmp(t); const orc = new RecallIndex(path.join(d, 'o.jsonl')); orc.update('work/active/sub/y.md', '## first\nProject: billing\nwords here\n', { mtime: 1 }); for (let i = 0; i < 5; i++) orc.update(`notes/f${i}.md`, `## f\nfiller ${i}\n`, { mtime: 1 }); const file = path.join(d, 'index.jsonl'); orc.file = file; orc.dirty = true; orc.save(); const ix = new SegIndex(file); ix.load();
  const x = '## added\nappended words\n'; orc.appendSections('work/active/sub/y.md', x, { lineOffset: 9, mtime: 2 }); ix.appendSections('work/active/sub/y.md', x, { lineOffset: 9, mtime: 2 }); assert.deepEqual(ix.docsOf('work/active/sub/y.md', 'added').map((q) => q.project), ['billing']);
});

test('a write during a fold: appends, rewrites and deletes all come out once, and survive a reload', async (t) => {
  const d = tmp(t); const { orc, ix, file } = seeded(d); writes(orc, ix, 21, 40); ix.save(); const before = ix.gen; const p = ix.foldSoon();
  // A path with sections already in the overlay gets an append during the fold: its folded sections must not come back twice.
  const r = rng(99); const inOverlay = [...ix.ov.byPath.keys()].slice(0, 8); for (const q of inOverlay) { const x = `## during\nduring the fold words ${WORDS[Math.floor(r() * WORDS.length)]}\n`; orc.appendSections(q, x, { lineOffset: 900, mtime: 8 }); ix.appendSections(q, x, { lineOffset: 900, mtime: 8 }); } writes(orc, ix, 22, 30, 300);
  agree(orc, ix, 'during'); await settle(p); assert.ok(ix.gen > before, 'the fold finished'); agree(orc, ix, 'after'); for (const q of inOverlay) assert.equal(ix.docsOf(q).length, orc.docsOf(q).length, `${q} once`);
  ix.save(); const again = new SegIndex(file); assert.equal(again.load(), true); agree(orc, again, 'reloaded');
});

test('a save costs what changed, not the size of the overlay', (t) => {
  const d = tmp(t); const { ix } = seeded(d, 300); const r = rng(3); for (let i = 0; i < 400; i++) ix.update(`notes/big${i}.md`, note(r, i), { mtime: 1 }); const f = ix.foldSoon; ix.foldSoon = () => null; ix.save();
  const w = fs.writeSync; let bytes = 0; fs.writeSync = function (fd, b, ...a) { bytes += b.length; return w.call(fs, fd, b, ...a); }; t.after(() => { fs.writeSync = w; }); const wf = fs.writeFileSync; fs.writeFileSync = function (x, b, ...a) { bytes += b.length ?? 0; return wf.call(fs, x, b, ...a); }; t.after(() => { fs.writeFileSync = wf; });
  ix.update('notes/one.md', '## one\nsmall change\n', { mtime: 2 }); ix.save(); ix.foldSoon = f; assert.ok(bytes < 2000, `${bytes} bytes written for one small note`);
});

test('a fold frees the files of the old generation', async (t) => {
  const d = tmp(t); const { orc, ix } = seeded(d, 200); writes(orc, ix, 31, 20); ix.save(); const old = ix.seg; let closed = 0; const c = old.close; old.close = function () { closed++; return c.call(this); }; const oldDir = ix._dir(ix.gen); await settle(ix.foldSoon()); assert.equal(closed, 1, 'the old segment is closed');
  for (let i = 0; i < 100 && fs.existsSync(oldDir); i++) await new Promise((r) => setTimeout(r, 10)); assert.equal(fs.existsSync(oldDir), false, 'the old generation is removed');
});

test('a generation number left by a kill is not used again', async (t) => {
  const d = tmp(t); const { orc, ix, file } = seeded(d, 100); writes(orc, ix, 81, 5); ix.save(); const base = `${file.replace(/\.jsonl$/, '')}.seg`; const next = path.join(base, `gen-${ix.gen + 1}`); fs.mkdirSync(next); fs.writeFileSync(path.join(next, 'leftover'), 'x'); const again = new SegIndex(file); assert.equal(again.load(), true); await settle(again.foldSoon()); assert.ok(again.gen > ix.gen + 1, `generation ${again.gen}`); agree(orc, again, 'after');
});

test('a segment of another version asks for a rebuild', (t) => {
  const d = tmp(t); const { ix, file } = seeded(d, 40); const head = path.join(ix._dir(ix.gen), 'head.json'); const j = JSON.parse(fs.readFileSync(head, 'utf8')); j.version -= 1; fs.writeFileSync(head, JSON.stringify(j)); assert.equal(new SegIndex(file).load(), false);
});

test('a failed fold leaves the index serving and does not retry on every save', async (t) => {
  const d = tmp(t); const { orc, ix } = seeded(d, 200); writes(orc, ix, 41, 10); ix.save(); const dir = ix._dir(ix.gen); const seg = ix.seg; seg.cols(); fs.renameSync(path.join(dir, 'cols.bin'), path.join(dir, 'cols.moved')); await settle(ix.foldSoon()); fs.renameSync(path.join(dir, 'cols.moved'), path.join(dir, 'cols.bin')); assert.equal(ix.seg, seg, 'still the old segment'); assert.equal(ix.foldP, null); assert.ok(ix.foldFailed > 0); agree(orc, ix, 'after a failed fold');
});

for (const step of ['mid-fold', 'before-publish', 'after-publish', 'torn']) {
  test(`a kill at ${step} leaves the index matching what was saved`, (t) => {
    const d = tmp(t); const { orc, ix, file } = seeded(d, 300); writes(orc, ix, 51, 30); ix.save();
    const r = kill({ dir: d, step }); assert.equal(r.signal, 'SIGKILL', `the child died at the step: ${r.stderr}`);
    orc.appendSections('notes/sealed.md', '## sealed\nsealed text words\n', { lineOffset: 1, mtime: 1 }); orc.appendSections('notes/sealed.md', '## tail\ntail text words\n', { lineOffset: 3, mtime: 2 });
    const again = new SegIndex(file); assert.equal(again.load(), true); agree(orc, again, `after a kill at ${step}`);
    assert.deepEqual(fs.readdirSync(`${file.replace(/\.jsonl$/, '')}.seg`).filter((e) => e.startsWith('gen-')).length >= 1, true); again.update('notes/after.md', '## after\nafter the kill\n', { mtime: 3 }); orc.update('notes/after.md', '## after\nafter the kill\n', { mtime: 3 }); again.save(); const third = new SegIndex(file); assert.equal(third.load(), true); agree(orc, third, 'written after recovery');
  });
}
