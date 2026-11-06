// SPDX-License-Identifier: Apache-2.0
// The recall index with RecallIndex's interface and answers, over an on-disk segment and a small overlay.
// Nothing is loaded at open. A save appends what changed to the overlay log. A fold runs on a worker and is the log's checkpoint:
// it folds the log up to an offset into a new segment, and only the log's tail moves to the new generation.
// CURRENT names the generation; a generation folder holds its segment and its log, so a kill leaves a matching pair.
//
// A generation found damaged (segment.mjs says how) stops serving at once: CURRENT goes, so no later start can trust it, and the index is
// rebuilt from the notes, at the open that found it or, once serving, on a worker while recall says it is rebuilding. An empty answer from
// a damaged generation would look like "nothing recorded", so a query that meets damage gets an error instead.
//
// A folder is claimed with a `writing` file naming the process building it, there from its first moment and until CURRENT moves past it.
// No process removes a folder whose writer is alive, so a command that opens the vault beside a daemon cannot pull a load or a fold from under it.
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { RecallIndex, tokenize, INDEX_VERSION as OLD_VERSION } from './index.mjs';
import { readLines } from './oplog.mjs';
import { writeSeg, overlayDocs, Seg, SegDamage, RebuildFailed, SegOtherVersion, IndexBusy, isPassing, readOverlayLine, sealLine, verifySegFiles, foldFiles, foldInWorker, keySig, ROW, C_LEN, C_PATH, C_PROJ, C_RB, C_SIG } from './segment.mjs';

/** The old index file's sections one at a time, into a segment: no index in memory. False when the file is not a whole index of the version this code reads. */
export function convertOldIndex(file, dir, tick) {
  const lines = readLines(file); const first = lines.next();
  if (first.done) return false;
  let head; try { head = JSON.parse(first.value[0]); } catch { lines.return(); return false; }
  if (head.version !== OLD_VERSION) { lines.return(); return false; }
  function* docs() { for (const [line] of lines) { if (!line) continue; tick?.(); const r = JSON.parse(line); const terms = new Array(r.t.length); for (let i = 0; i < r.t.length; i++) terms[i] = [r.t[i], r.f[i]]; yield { path: r.path, heading: r.heading ?? null, line: r.line ?? 1, len: r.len, project: r.project ?? null, mtime: r.mtime ?? null, snippet: r.snippet, rb: r.rb ?? null, fl: r.fl ?? null, terms }; } }
  try { writeSeg(dir, docs()); } catch (e) { lines.return(); fs.rmSync(dir, { recursive: true, force: true }); if (e instanceof SyntaxError) return false; throw e; }
  return true;
}

const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0; const WRITING = 'writing';
// Folders this process is writing, for any index in it. Another process's are known by the pid in their `writing` file.
const inFlight = new Set();
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
/** True when a live process is still writing this folder. */
function beingWritten(dir) {
  let pid; try { const fd = fs.openSync(path.join(dir, WRITING), fs.constants.O_RDONLY | NOFOLLOW); try { pid = Number(fs.readFileSync(fd, 'utf8')); } finally { fs.closeSync(fd); } } catch (e) { return isPassing(e); } // a file that cannot be read just now may name a live writer
  if (pid === process.pid) return inFlight.has(dir);
  return Number.isSafeInteger(pid) && pid > 0 && alive(pid);
}
/** Sections from [path, body] pairs as writeSeg takes them, with the index's own code turning each note into sections. Nothing is held but the note in hand. */
export function* docsOfNotes(notes) {
  const out = []; const sink = new RecallIndex('/nonexistent'); sink._add = (p, d) => { out.push({ path: p, heading: d.heading ?? null, line: d.line ?? 1, len: d.len, project: d.project ?? null, mtime: d.mtime ?? null, snippet: d.snippet, rb: d.rb ?? null, fl: d.fl ?? null, terms: d.tf }); };
  for (const [p, body] of notes) { sink.update(p, body); yield* out; out.length = 0; }
}

const round3 = (x) => Number(x.toFixed(3));
const empty = () => Object.defineProperty([], 'total', { value: 0, writable: true, configurable: true });
// The largest boost and a bitmap of the boosted keys, once per tuning. Tuning is replaced whole, never edited (tuning.mjs).
const boostCache = new WeakMap();
const boostInfo = (boosts) => { let k = boostCache.get(boosts); if (!k) { let max = 1, count = 0; for (const key in boosts) { count++; if (boosts[key] > max) max = boosts[key]; } k = { max, sieve: count ? new KeySieve(Object.keys(boosts), count) : null }; boostCache.set(boosts, k); } return k; };
const K1 = 1.2, B = 0.75, K1P = K1 + 1, B0 = 1 - B; // RecallIndex._bm's constants, written out in its order of operations so the doubles are the same
/** A small bitmap of key signatures: a section whose signature is absent cannot be one of these keys. */
class KeySieve {
  constructor(keys, count) { let bits = 1 << 12; while (bits < count * 16) bits <<= 1; this.mask = bits - 1; this.m = new Uint8Array(bits >>> 3); for (const k of keys) { const h = keySig(k) & this.mask; this.m[h >>> 3] |= 1 << (h & 7); } }
  has(sig) { const h = sig & this.mask; return (this.m[h >>> 3] & (1 << (h & 7))) !== 0; }
}
const FOLD_MIN = 2000, FOLD_SHARE = 0.05, RETRY_MS = 60000, LOG_MAX = 1 << 26; // a note rewritten over and over grows the log, not the overlay

/** One section of the segment. Columns cost nothing; text is read only when asked for. `at` moves it, so a query needs only one. */
class SegDoc {
  constructor(seg, i) { this.seg = seg; this.i = i; this.c = seg.cols(); this.m = null; this.sieve = null; this.sieveOf = null; this.read = false; }
  at(i) { this.i = i; this.m = null; return this; }
  get len() { return this.c[this.i * ROW + C_LEN]; }
  get path() { return this.seg.paths[this.c[this.i * ROW + C_PATH] - 1]; }
  get project() { const j = this.c[this.i * ROW + C_PROJ]; return j ? this.seg.projects[j - 1] : null; }
  get heading() { return this.seg.heading(this.i); }
  get rb() { return this.seg.rb(this.i); }
  /** The value for this section's item key in a Map of them. The bitmap answers most sections without building the key. */
  lookup(map) { if (this.sieve === null || this.sieveOf !== map) { this.sieve = new KeySieve(map.keys(), map.size); this.sieveOf = map; } if (!this.sieve.has(this.c[this.i * ROW + C_SIG])) return undefined; this.read = true; return map.get(`${this.path}#${this.heading || ''}`); }
  get fl() { return this.seg.hasFl(this.i) ? this._meta().fl : null; }
  get line() { return this._meta().line; }
  get snippet() { return this._meta().snippet; }
  get mtime() { return this._meta().mtime; }
  _meta() { return this.m || (this.m = this.seg.meta(this.i)); }
}

/**
 * The document a filter sees. A pure filter that read only the project and the review date gives the same verdict for every
 * section with those values, so the verdict is kept per project for sections with no review date and the rest are not asked.
 */
class FilterDoc extends SegDoc {
  get path() { this.read = true; return super.path; }
  get heading() { this.read = true; return super.heading; }
  get line() { this.read = true; return super.line; }
  get snippet() { this.read = true; return super.snippet; }
  get mtime() { this.read = true; return super.mtime; }
  get fl() { this.read = true; return super.fl; }
  get len() { this.read = true; return super.len; }
}

export class SegIndex {
  constructor(file) { this.file = file; this.base = file.replace(/\.jsonl$/, ''); this.root = `${this.base}.seg`; this._clear(); }
  _clear() { this.seg = null; this.ov = new RecallIndex('/nonexistent'); this.dead = null; this.deadCount = 0; this.deadPaths = new Set(); this.deadLen = 0; this.gen = 0; this.logFd = null; this.logEnd = 0; this.pending = []; this.dirty = false; this.foldP = null; this.foldFailed = 0; this.lastGen = 0; this.score = null; this.syncing = false; this.syncAgain = false; this.oldLog = null; this.waiters = []; this.rebuilding = null; this.damage = null; this.epoch = 0; this.onDamage = null; this.retry = []; }
  reset() { this._closeFiles(); const { onDamage } = this; this._clear(); this.onDamage = onDamage; fs.rmSync(this.root, { recursive: true, force: true }); }
  _closeFiles() { if (this.logFd !== null) { if (this.syncing) this.oldLog = this.logFd; else fs.closeSync(this.logFd); this.logFd = null; } if (this.seg) { this.seg.close(); this.seg = null; } }
  _dir(g) { return path.join(this.root, `gen-${g}`); }
  _log(g) { return path.join(this._dir(g), 'overlay.log'); }
  _publish(g) { const cur = path.join(this.root, 'CURRENT'), t = `${cur}.tmp`; fs.rmSync(t, { force: true }); const fd = fs.openSync(t, 'wx', 0o600); fs.writeSync(fd, String(g)); fs.fsyncSync(fd); fs.closeSync(fd); fs.renameSync(t, cur); try { const d = fs.openSync(this.root, 'r'); fs.fsyncSync(d); fs.closeSync(d); } catch { /* a folder cannot be synced on Windows */ } }
  /** The number in CURRENT, null with no CURRENT, NaN when it holds anything else. A link there is damage, not a name to follow. */
  _current() {
    let text; try { const fd = fs.openSync(path.join(this.root, 'CURRENT'), fs.constants.O_RDONLY | NOFOLLOW); try { text = fs.readFileSync(fd, 'utf8'); } finally { fs.closeSync(fd); } } catch (e) { if (isPassing(e)) throw e; return e.code === 'ENOENT' || e.code === 'ENOTDIR' ? null : NaN; }
    return /^[1-9]\d{0,14}$/.test(text) ? Number(text) : NaN;
  }
  /** A new folder for a generation, whose number no other process can hold: it is built aside with its `writing` file and renamed into place. */
  _claim() {
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    for (;;) {
      const g = ++this.lastGen, dir = this._dir(g), t = path.join(this.root, `tmp-${process.pid}-${g}`);
      fs.rmSync(t, { recursive: true, force: true }); fs.mkdirSync(t, { mode: 0o700 }); fs.writeFileSync(path.join(t, WRITING), String(process.pid), { mode: 0o600 });
      inFlight.add(dir);
      try { fs.renameSync(t, dir); return g; } catch (e) { inFlight.delete(dir); fs.rmSync(t, { recursive: true, force: true }); if (e.code !== 'EEXIST' && e.code !== 'ENOTEMPTY' && e.code !== 'EPERM') throw e; }
    }
  }
  /** CURRENT has moved to this folder, so it needs no guarding: only now, or a sweep elsewhere could take it for a leftover before it saw CURRENT move. */
  _claimDone(g) { const dir = this._dir(g); inFlight.delete(dir); fs.rmSync(path.join(dir, WRITING), { force: true }); }
  _unclaim(g) { inFlight.delete(this._dir(g)); fs.rm(this._dir(g), { recursive: true, force: true }, () => {}); }
  // Old folders go in the background, so a generation's number is never used twice: a removal still running cannot touch a new folder.
  // A folder a live process is writing stays, and CURRENT is read after that check, so a folder whose writer has just published is seen as current.
  _sweep(keep) {
    let list = []; try { list = fs.readdirSync(this.root); } catch { return; } this.lastGen = Math.max(this.lastGen, keep);
    for (const e of list) {
      if (e.startsWith('tmp-')) { const pid = Number(e.split('-')[1]); if (pid !== process.pid && !(Number.isSafeInteger(pid) && pid > 0 && alive(pid))) fs.rm(path.join(this.root, e), { recursive: true, force: true }, () => {}); continue; }
      if (!e.startsWith('gen-') || e === `gen-${keep}`) continue;
      this.lastGen = Math.max(this.lastGen, Number(e.slice(4)) || 0); const dir = path.join(this.root, e);
      let current; try { current = this._current(); } catch { continue; } // this is only tidying: it waits for a start that can read CURRENT
      if (beingWritten(dir) || e === `gen-${current}`) continue;
      fs.rm(dir, { recursive: true, force: true }, () => {});
    }
  }
  /** Give up on what is on the disk. Only the generations nobody is writing go; the next build takes the next number. */
  _discard() { fs.rmSync(path.join(this.root, 'CURRENT'), { force: true }); this._sweep(0); }

  /** Replay log bytes into a generation's state: the same steps a write took, so ids and their order come out the same. */
  _replay(st, text) { for (let s = 0; s < text.length;) { const e = text.indexOf('\n', s); if (e < 0) throw new SegDamage('overlay.log: a line with no end'); const r = readOverlayLine(text.slice(s, e)); s = e + 1; if (r.rm !== undefined) { this._retireIn(st, r.rm); st.ov.remove(r.rm); } else { st.ov._addLine(r); } } }
  _state(seg) { return { seg, ov: new RecallIndex('/nonexistent'), dead: new Uint8Array(seg.head.n), deadCount: 0, deadPaths: new Set(), deadLen: 0 }; }
  _retireIn(st, p) { if (st.deadPaths.has(p)) return; const c = st.seg.cols(), list = st.seg.ordinalsOf(p); st.deadPaths.add(p); for (const i of list) { if (!st.dead[i]) { st.dead[i] = 1; st.deadCount++; st.deadLen += c[i * ROW + C_LEN]; } } }

  load(tick) {
    this.loadDamage = null;
    // A link in place of the folder is never followed: only the link goes, and the index is built in a folder of its own.
    let top = null; try { top = fs.lstatSync(this.root); } catch { /* no segment yet */ }
    if (top && !top.isDirectory()) { this.loadDamage = 'index.seg is not a folder'; fs.unlinkSync(this.root); }
    let g = this._current();
    // The old file beside a segment means an older version ran here since and kept its own index, which is then the newer of the two: it is converted again.
    if (g !== null && fs.existsSync(this.file)) { this._sweep(Number.isNaN(g) ? 0 : g); fs.rmSync(path.join(this.root, 'CURRENT'), { force: true }); g = null; }
    if (g === null) {
      if (!fs.existsSync(this.file)) return false;
      // One conversion from the old file, which goes only once the new generation is published. A kill before that starts it over.
      fs.mkdirSync(this.root, { recursive: true, mode: 0o700 }); this._sweep(this.gen); const ng = this._claim();
      if (!convertOldIndex(this.file, this._dir(ng), tick)) { this._unclaim(ng); return false; }
      this._adopt(ng); return true;
    }
    // Another version or damage: rebuilt from the notes. A file that could not be read just now is neither, and the open fails and is tried again.
    const giveUp = (e) => { if (isPassing(e)) throw e; if (e instanceof SegDamage) this.loadDamage = e.why; this._discard(); return false; };
    if (Number.isNaN(g)) return giveUp(new SegDamage('CURRENT does not name a generation'));
    this.lastGen = Math.max(this.lastGen, g); let seg;
    try {
      const st = fs.lstatSync(this._dir(g)); if (!st.isDirectory()) throw new SegDamage(`gen-${g} is not a folder`);
      seg = new Seg(this._dir(g));
    } catch (e) { return giveUp(e.code === 'ENOENT' ? new SegDamage(`gen-${g} is gone`) : e); }
    let state, text = '', fd = null, end = 0;
    try {
      state = this._state(seg);
      try { fd = fs.openSync(this._log(g), fs.constants.O_RDWR | NOFOLLOW); } catch (e) { if (isPassing(e)) throw e; if (e.code !== 'ENOENT') throw new SegDamage(`overlay.log: ${e.code}`); fd = fs.openSync(this._log(g), 'wx+', 0o600); } // a link here must not be cut
      if (!fs.fstatSync(fd).isFile()) throw new SegDamage('overlay.log is not a file');
      text = fs.readFileSync(fd, 'utf8');
      // A kill can cut the last line. It is dropped here; the vault replays anything past its saved log position.
      end = Buffer.byteLength(text); const nl = text.lastIndexOf('\n'); if (nl !== text.length - 1) { text = text.slice(0, nl + 1); end = Buffer.byteLength(text); }
      // A complete line that does not parse is not a kill's mark. The notes are the record: the index is rebuilt from them.
      this._replay(state, text);
    } catch (e) { if (fd !== null) fs.closeSync(fd); seg.close(); return giveUp(e instanceof SegDamage || isPassing(e) ? e : new SegDamage(`overlay.log: ${e.code || e.message}`)); }
    Object.assign(this, state); this.gen = g; this.logFd = fd; fs.ftruncateSync(this.logFd, end); this.logEnd = end; this.dirty = false; this._watch(seg); this._sweep(g);
    return true;
  }
  _watch(seg) { seg.onDamage = (e) => this._damaged(e.why, seg); }
  /**
   * A served generation turned out damaged. Nothing more is read from it, and CURRENT goes first, so a kill from here on means a rebuild at the
   * next start. The caller's query still fails, with this error. Writes go on: they reach the notes and the log, and the rebuild picks them up.
   */
  _damaged(why, seg = this.seg) {
    if (this.rebuilding || !seg || seg !== this.seg) return;
    let cur = this.gen; try { cur = this._current(); } catch { /* what was found stands */ }
    if (cur !== null && cur !== this.gen) { // another process moved on, and the file was only gone: this is a stale view and the index is sound
      this._closeFiles(); const { lastGen, onDamage } = this; this._clear(); this.lastGen = lastGen; this.onDamage = onDamage; if (this.load()) return;
    }
    this.damage = { why, at: new Date().toISOString() }; this.rebuilding = { state: 'waiting' }; this.epoch++;
    this._closeFiles(); fs.rmSync(path.join(this.root, 'CURRENT'), { force: true }); this.dead = null; this.deadCount = 0; this.deadPaths = new Set(); this.deadLen = 0; this.ov = new RecallIndex('/nonexistent'); this.pending = []; this.dirty = false; this.waiters = []; this.syncAgain = false; this.foldP = null; this.gen = 0; this.retry = []; this._sweep(0);
    this.onDamage?.(why);
  }
  /** Build the new generation from the notes on a worker. Resolves when it serves; what was written meanwhile is the caller's to apply. */
  rebuildFromNotes(vaultRoot) {
    const g = this._claim(), epoch = this.epoch;
    const p = new Promise((res, rej) => { const w = new Worker(new URL('./notes-worker.mjs', import.meta.url), { workerData: { job: 'index', root: vaultRoot, dir: this._dir(g) } }); w.unref(); this.rebuilding = { state: 'running', worker: w }; w.once('message', () => res()); w.once('error', rej); w.once('exit', (c) => rej(new Error(`the index worker exited ${c}`))); });
    return p.then(() => {
      if (epoch !== this.epoch || !this.rebuilding) { this._unclaim(g); return false; }
      const seg = new Seg(this._dir(g)); fs.writeFileSync(this._log(g), '', { flag: 'wx', mode: 0o600 }); this._publish(g); this._claimDone(g);
      Object.assign(this, this._state(seg)); this.gen = g; this.logFd = fs.openSync(this._log(g), fs.constants.O_RDWR | NOFOLLOW); this.logEnd = 0; this.pending = []; this.dirty = false; this.rebuilding = null; this._watch(seg);
      return true;
    }, (e) => { this._unclaim(g); throw e; });
  }
  /** The worker could not build the index. Nothing will come of waiting, so recall says that and what to do. A start tries again, as CURRENT is gone. */
  rebuildFailed(why) { this.rebuilding = { state: 'failed', why }; }
  /** The vault is closing: no fold or rebuild still running may publish from here on. What it wrote is a leftover for the next open. */
  stopWork() { this.epoch++; try { this.rebuilding?.worker?.terminate(); } catch { /* it ends with the process */ } }
  /** Every file of the serving generation against its sums, here and now: what is wrong, or null. A find stops serving it. */
  verifyNow() {
    if (!this.seg) return null; const seg = this.seg, why = verifySegFiles(seg.dir, seg.head); if (why) this._damaged(why, seg); return why;
  }
  /** What the sweep's worker needs to check the same, and the answer it brings back. A generation that has been folded away since is no finding. */
  sealed() { return this.seg ? { gen: this.gen, dir: this.seg.dir } : null; }
  damagedGen(gen, why) { if (gen === this.gen && this.seg) this._damaged(why); }
  state() { return { state: this.rebuilding?.state === 'failed' ? 'failed' : this.rebuilding ? 'rebuilding' : 'ok', damage: this.damage }; }
  _serving() { if (this.rebuilding?.state === 'failed') throw new RebuildFailed(this.rebuilding.why); if (this.rebuilding) throw new SegDamage(this.damage?.why || 'it is being rebuilt'); }
  /**
   * Where the index stands on the disk, saved beside the log position. A later start finding it behind this has lost something no check of
   * the files can see, whole lines cut off the log or an older folder restored. Further on is what a hard kill leaves, and the log catches that up.
   */
  position() { return this.seg ? { gen: this.gen, end: this.logEnd } : null; }
  behind(saved) {
    if (!this.seg || !saved) return null;
    if (this.gen < saved.gen) return `index.seg is older than it was left: generation ${this.gen}, and ${saved.gen} was saved`;
    if (this.gen === saved.gen && this.logEnd < saved.end) return `overlay.log is shorter than it was left: ${this.logEnd} bytes, and ${saved.end} were saved`;
    return null;
  }
  /** Let go of a generation that opened sound but cannot be trusted: the caller rebuilds from the notes. */
  drop() { this._closeFiles(); this.dead = null; this.deadCount = 0; this.deadPaths = new Set(); this.deadLen = 0; this.gen = 0; this.logEnd = 0; this.dirty = false; this.ov = new RecallIndex('/nonexistent'); this._discard(); }
  /**
   * A write's step on the index. A write has already reached the notes and the log, so nothing met here fails it. Damage is the rebuild's to
   * pick up. A read that failed in passing leaves the step waiting, in order, for the next query or save, and the log position stays behind it.
   */
  _writeStep(fn) { if (this.rebuilding) return; this._drain(); if (this.retry.length) { this.retry.push(fn); return; } try { fn(); } catch (e) { if (isPassing(e)) this.retry.push(fn); else if (!(e instanceof SegDamage)) throw e; } }
  _drain() { while (this.retry.length) { try { this.retry[0](); this.retry.shift(); } catch (e) { if (e instanceof SegDamage) { this.retry = []; return; } if (isPassing(e)) return; throw e; } } }
  retrying() { return this.retry.length > 0; }
  /** A read of the index. One that fails in passing fails this one question, in words that say so; nothing is thrown away and the next one tries again. */
  _asking(fn) { this._serving(); this._drain(); this._serving(); try { if (this.retry.length) throw new IndexBusy('a write is waiting to reach it'); return fn(); } catch (e) { if (isPassing(e)) throw new IndexBusy(e.code); throw e; } }
  _writeFromOverlay() {
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 }); this._sweep(this.gen); const g = this._claim(); const ov = this.ov;
    writeSeg(this._dir(g), overlayDocs(ov));
    this._adopt(g);
  }
  // A whole new segment in generation g becomes the index, with an empty log: nothing shows until CURRENT names it.
  _adopt(g) { this._closeFiles(); const log = this._log(g); fs.writeFileSync(log, '', { flag: 'wx', mode: 0o600 }); const seg = new Seg(this._dir(g)); this._publish(g); this._claimDone(g); Object.assign(this, this._state(seg)); this.gen = g; this.logFd = fs.openSync(log, fs.constants.O_RDWR | NOFOLLOW); this.logEnd = 0; this.pending = []; this.dirty = false; this._watch(seg); this._sweep(g); fs.rmSync(this.file, { force: true }); } // the old file goes last: until then a kill starts the conversion over
  /**
   * Build the first segment straight from notes, one at a time, with the index's own code turning each into sections: nothing is held in
   * memory but the postings. `notes` yields [path, body]. Nothing shows until it is published, so a crash leaves no half index.
   */
  buildFrom(notes) {
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 }); this._sweep(this.gen); const g = this._claim();
    writeSeg(this._dir(g), docsOfNotes(notes)); this._adopt(g);
  }
  // What changed goes to the log before the save returns, so a killed process keeps it; the wait for the disk is on the thread pool.
  _flush() {
    if (!this.pending.length) return; let out = '';
    for (const o of this.pending) { if (typeof o === 'string') out += `${sealLine(JSON.stringify({ rm: o }))}\n`; else { const d = this.ov.docs.get(o); if (d) out += `${sealLine(this.ov._docLine(d))}\n`; } }
    const b = Buffer.from(out);
    try { fs.writeSync(this.logFd, b, 0, b.length, this.logEnd); } catch (e) { try { fs.ftruncateSync(this.logFd, this.logEnd); } catch { /* the next load drops a cut line */ } throw e; }
    this.logEnd += b.length; this.pending = []; this._syncLog();
  }
  _syncLog() {
    if (this.syncing) { this.syncAgain = true; return; } if (this.logFd === null) return; this.syncing = true; const fd = this.logFd; const waiting = this.waiters; this.waiters = [];
    fs.fdatasync(fd, (e) => {
      this.syncing = false; if (this.oldLog === fd) { this.oldLog = null; fs.close(fd, () => {}); }
      if (!e) for (const f of waiting) f();
      if ((this.syncAgain || this.waiters.length) && this.logFd !== null) { this.syncAgain = false; this._syncLog(); }
    });
  }
  /** Call back once everything saved so far is on the disk. The vault writes its log position here, so that position is never ahead of the index. */
  whenSynced(f) { if (this.rebuilding) return; if (!this.syncing && !this.waiters.length && !this.syncAgain) { f(); return; } this.waiters.push(f); if (!this.syncing) this._syncLog(); else this.syncAgain = true; }
  /** The same, waiting here: for a stop. */
  syncNow() { if (this.logFd !== null) fs.fdatasyncSync(this.logFd); }
  save() {
    if (this.rebuilding) return; this._drain();
    if (!this.dirty) return;
    if (!this.seg) { this._writeFromOverlay(); return; }
    this._flush(); this.dirty = false;
    if (!this.foldP && Date.now() - this.foldFailed > RETRY_MS && (this.ov.docs.size > Math.max(FOLD_MIN, this.seg.head.n * FOLD_SHARE) || this.deadCount > Math.max(FOLD_MIN, this.seg.head.n / 5) || this.logEnd > (this.logMax ?? LOG_MAX))) this.foldSoon();
  }
  /** Start a fold of the log as it stands. Reads and writes go on against this generation until the new one is ready. */
  foldSoon() {
    if (this.foldP || !this.seg) return this.foldP; this._flush(); const g = this._claim(); const sealed = this.logEnd; const epoch = this.epoch; const from = this.seg;
    const p = foldInWorker(this._dir(this.gen), this._dir(g), this._log(this.gen), sealed).then((r) => { if (epoch !== this.epoch) throw new Error('the index was replaced during the fold'); if (r.damage) { this._damaged(r.damage, from); throw new Error(r.damage); } return this._swap(g, sealed, r, epoch); }).catch((e) => { if (this.foldP === p) this.foldP = null; this.foldFailed = Date.now(); this.foldError = e; this._unclaim(g); });
    this.foldP = p;
    return this.foldP;
  }
  // What was written after the seal moves to the new generation. Every wait for the disk is on the thread pool, between steps;
  // writes that arrive meanwhile are copied in the last step, which is the only one that changes anything and ends with CURRENT.
  async _swap(g, sealed, built, epoch = this.epoch) {
    const fd = fs.openSync(this._log(g), 'wx+', 0o600); const cur = path.join(this.root, 'CURRENT'), tmp = `${cur}.tmp`; let copied = sealed, at = 0; const tail = [];
    const copy = () => { const n = this.logEnd - copied; if (!n) return 0; const b = Buffer.allocUnsafe(n); fs.readSync(this.logFd, b, 0, n, copied); fs.writeSync(fd, b, 0, n, at); at += n; copied += n; tail.push(b); return n; };
    const done = (f, ...x) => new Promise((res, rej) => f(...x, (e) => (e ? rej(e) : res())));
    try {
      this._flush(); copy(); await done(fs.fdatasync, fd);
      fs.rmSync(tmp, { force: true }); const t = fs.openSync(tmp, 'wx', 0o600); fs.writeSync(t, String(g)); await done(fs.fsync, t); fs.closeSync(t);
      const seg = new Seg(this._dir(g), built.cols, built.byPath); seg.cols(); await new Promise((res) => setImmediate(res));
      while (copy()) await done(fs.fdatasync, fd); // a save that finished is durable in the new log before CURRENT moves
      if (epoch !== this.epoch) { seg.close(); throw new Error('the index was replaced during the fold'); }
      this._flush(); copy(); const st = this._state(seg); this._replay(st, Buffer.concat(tail).toString('utf8')); fs.renameSync(tmp, cur); this._claimDone(g); this._watch(seg);
      const was = this.gen; const oldLog = this.logFd, oldSeg = this.seg; Object.assign(this, st); this.gen = g; this.logFd = fd; this.logEnd = at; this.foldP = null;
      if (this.syncing) this.oldLog = oldLog; else fs.close(oldLog, () => {}); oldSeg.close(); this._syncLog(); // the last bytes copied
      fs.open(this.root, 'r', (e, dfd) => { const rm = () => fs.rm(this._dir(was), { recursive: true, force: true }, () => {}); if (e) return rm(); return fs.fsync(dfd, () => fs.close(dfd, rm)); }); // a folder cannot be synced on Windows; the error is not checked for that reason
    } catch (e) { try { fs.closeSync(fd); } catch { /* already closed */ } throw e; }
  }
  /** memev compact: the daemon is stopped, so the fold runs here and the old generation is gone when this returns. */
  compact() {
    if (!this.seg || this.foldP) return; this._flush(); if (!this.logEnd) return; const g = this._claim(), was = this.gen;
    try { foldFiles(this._dir(was), this._dir(g), this._log(was), this.logEnd); } catch (e) { this._unclaim(g); if (!(e instanceof SegDamage)) throw e; this._damaged(e.why); return; }
    fs.writeFileSync(this._log(g), '', { flag: 'wx', mode: 0o600 });
    const seg = new Seg(this._dir(g)); this._publish(g); this._claimDone(g); this._closeFiles(); Object.assign(this, this._state(seg)); this.gen = g; this.logFd = fs.openSync(this._log(g), fs.constants.O_RDWR | NOFOLLOW); this.logEnd = 0; this._watch(seg); fs.rmSync(this._dir(was), { recursive: true, force: true });
  }
  _retire(p) { if (this.seg) this._retireIn(this, p); }
  _added(from) { for (let id = from; id < this.ov.nextId; id++) this.pending.push(id); this.dirty = true; }
  remove(p) { this._writeStep(() => { this._retire(p); this.ov.remove(p); this.pending.push(p); this.dirty = true; }); }
  update(p, body, o) { this._writeStep(() => { this._retire(p); const from = this.ov.nextId; this.ov.update(p, body, o); this.pending.push(p); this._added(from); }); }
  appendSections(p, text, o = {}) {
    this._writeStep(() => {
      let project = o.project ?? null;
      if (!project && !/^work\/active\/([^/]+)\.md$/.test(p) && this.seg && !this.deadPaths.has(p)) { const doc = new SegDoc(this.seg, 0); for (const i of this.seg.ordinalsOf(p)) { project = doc.at(i).project; if (project) break; } }
      const from = this.ov.nextId; this.ov.appendSections(p, text, { ...o, project }); this._added(from);
    });
  }
  get byPath() { const me = this; return { has(p) { if (me.rebuilding) return false; try { return me.ov.byPath.has(p) || (!!me.seg && !me.deadPaths.has(p) && me.seg.ordinalsOf(p).length > 0); } catch (e) { if (e instanceof SegDamage || isPassing(e)) return false; throw e; } } }; }
  get docs() { const me = this; return { get size() { return me._N(); }, *values() { me._serving(); if (me.seg) for (let i = 0; i < me.seg.head.n; i++) if (!me.dead[i]) yield new SegDoc(me.seg, i); yield* me.ov.docs.values(); } }; }
  isEmpty() { return this._N() === 0; }
  _N() { return (this.seg ? this.seg.head.n - this.deadCount : 0) + this.ov.docs.size; }
  _Len() { return (this.seg ? this.seg.head.totalLen - this.deadLen : 0) + this.ov.totalLen; }
  /** A write asks this too, so damage met here is an empty answer for that write; a read that follows meets it again through query. */
  docsOf(p, heading) { if (this.rebuilding) return []; try { const out = []; if (this.seg && !this.deadPaths.has(p)) for (const i of this.seg.ordinalsOf(p)) { const d = new SegDoc(this.seg, i); if (heading === undefined || heading === null || (d.heading || '') === heading) out.push(d); } return out.concat(this.ov.docsOf(p, heading)); } catch (e) { if (e instanceof SegDamage || isPassing(e)) return []; throw e; } }
  stats() { let notes = this.ov.byPath.size, terms = this.ov.terms.size; if (this.seg) { const seg = this.seg; try { seg.cols(); for (const p of seg.paths) if (!this.deadPaths.has(p) && !this.ov.byPath.has(p) && seg.ordinalsOf(p).length) notes++; terms += seg.head.terms; } catch (e) { if (!(e instanceof SegDamage) && !isPassing(e)) throw e; return { sections: 0, notes: 0, terms: 0 }; } } return { sections: this._N(), notes, terms }; }

  // The words of a query as BM25 sees them, as RecallIndex._terms has them. After a write a word's live count takes a scan of its postings,
  // but a word that stays over the limit even if every dead section held it is dropped whatever the count, so a query need not scan it.
  // Exact counts are still taken for explain, and when dropping would leave no words.
  _plan(q, exact = false) {
    const seg = this.seg, ov = this.ov; const words = [...new Set(tokenize(q))]; const N = this._N(); const avg = N ? this._Len() / N : 0; const ts = []; const dead = this.dead, deadCount = this.deadCount; let skipped = false;
    for (const w of words) {
      const e = seg ? seg.lookup(w) : null; let ids = null, df = 0; const ot = ov.terms.get(w); const odf = ot === undefined ? 0 : ov.df(ot);
      if (e) {
        df = e.df;
        if (deadCount) { if (!exact && N > 2000 && e.df - deadCount + odf > N / 3) skipped = true; else { ids = seg.ids(e); for (let k = 0; k < e.df; k++) if (dead[ids[k]]) df--; } }
      }
      if (df + odf > 0) ts.push({ w, e, ids, ot, df: df + odf, over: skipped && e && deadCount && !ids });
    }
    ts.sort((x, y) => x.df - y.df); let terms = ts;
    if (N > 2000) { const rare = ts.filter((t) => !t.over && t.df <= N / 3); if (!rare.length && skipped && !exact) return this._plan(q, true); terms = (rare.length ? rare : ts.slice(0, 2)).slice(0, 12); }
    return { words, all: ts, terms, N, avg };
  }
  _scratch(need) { const n = this.seg ? this.seg.head.n : 0; if (!this.score || this.score.length < n) { const room = n + (n >> 3); this.score = new Float64Array(room); this.seen = new Uint32Array(room); this.stamp = 0; } if (!this.order || this.order.length < need) this.order = new Uint32Array(Math.max(need, 1024)); this.stamp++; }
  /** `drop` is a pure test of a path alone, asked once per path of a segment and remembered with it, so it costs a column read per section. */
  query(q, opts = {}) { return this._asking(() => this._query(q, opts)); }
  _query(q, { limit = 8, project = null, prefix = null, boosts = null, filter = null, drop = null } = {}) {
    if (!this._N()) return empty(); const { terms, N, avg } = this._plan(q); if (!terms.length) return empty();
    const seg = this.seg, ov = this.ov, n = seg ? seg.head.n : 0, dead = this.dead; let need = 0; for (const t of terms) need += (t.e ? t.e.df : 0) + (t.ot === undefined ? 0 : ov.postings[t.ot].length);
    this._scratch(need); const score = this.score, seen = this.seen, stamp = this.stamp, order = this.order; const c = seg ? seg.cols() : null; const ovScore = new Map(); let m = 0;
    // Sections are visited in the order RecallIndex first meets them, so equal scores rank the same: term by term, the segment's then the overlay's.
    for (const t of terms) {
      const idf = Math.log(1 + (N - t.df + 0.5) / (t.df + 0.5));
      if (t.e) { const ids = t.ids || seg.ids(t.e), tfs = seg.tfs(t.e), df = t.e.df; seg.checkList(t.e, ids, tfs); for (let k = 0; k < df; k++) { const i = ids[k]; if (dead[i]) continue; const f = tfs[k]; const part = idf * (f * K1P) / (f + K1 * (B0 + B * c[i * ROW + C_LEN] / avg)); if (seen[i] === stamp) score[i] += part; else { seen[i] = stamp; score[i] = part; order[m++] = i; } } }
      if (t.ot !== undefined) for (const id of ov.postings[t.ot]) { const d = ov.docs.get(id); if (!d) continue; const part = RecallIndex._bm(RecallIndex._tf(d, t.ot), t.df, N, d.len, avg).part; const was = ovScore.get(id); if (was === undefined) { ovScore.set(id, part); order[m++] = n + id; } else ovScore.set(id, was + part); }
    }
    const proj = project ? String(project).toLowerCase() : null; const top = []; let total = 0; const fly = seg ? new FilterDoc(seg, 0) : null; const plain = seg ? new SegDoc(seg, 0) : null;
    // Empty tuning is every daemon's first state: nothing can change a score, so no heading is needed.
    let maxB = 1, boostSieve = null; if (boosts) { const k = boostInfo(boosts); maxB = k.max; boostSieve = k.sieve; }
    const hasBoosts = boostSieve !== null; const projId = seg && proj ? seg.projectId(proj) : 0; const verdict = filter && seg ? new Int8Array(seg.projects.length + 1) : null; const dropped = drop && seg ? seg.pathVerdicts(drop) : null;
    for (let x = 0; x < m; x++) {
      const v = order[x]; let d, s, fp;
      if (v >= n) { d = ov.docs.get(v - n); s = ovScore.get(v - n); if (prefix && !d.path.startsWith(prefix)) continue; if (drop && drop(d.path)) continue; if (filter && !filter(d)) continue; fp = proj && d.project === proj ? 1.5 : 1; } else {
        s = score[v]; const o = v * ROW; if (prefix && !plain.at(v).path.startsWith(prefix)) continue;
        if (dropped) { const pid = c[o + C_PATH]; let x = dropped[pid]; if (!x) x = dropped[pid] = drop(seg.paths[pid - 1]) ? 2 : 1; if (x === 2) continue; }
        if (filter) {
          const j = c[o + C_PROJ]; const memo = verdict && c[o + C_RB] === 0 && (fly.sieve === null || !fly.sieve.has(c[o + C_SIG])) ? verdict[j] : 0;
          if (memo === 2) continue;
          if (memo === 0) { fly.at(v); fly.read = false; const ok = filter(fly); if (verdict && !fly.read && c[o + C_RB] === 0) verdict[j] = ok ? 1 : 2; if (!ok) continue; }
        }
        fp = projId && c[o + C_PROJ] === projId ? 1.5 : 1; d = null;
      }
      total++;
      // A section that could not reach the top even at the largest boost needs no boost lookup; multiplying up never rounds past it.
      if (top.length === limit && s * fp * maxB <= top[top.length - 1].score) continue;
      let fb = 1; if (hasBoosts) { if (d) fb = boosts[`${d.path}#${d.heading || ''}`] ?? 1; else if (boostSieve.has(c[v * ROW + C_SIG])) { plain.at(v); fb = boosts[`${plain.path}#${plain.heading || ''}`] ?? 1; } }
      const score2 = s * fp * fb;
      if (top.length === limit && score2 <= top[top.length - 1].score) continue;
      let i = top.length; while (i > 0 && top[i - 1].score < score2) i--; top.splice(i, 0, { v, score: score2 }); if (top.length > limit) top.pop();
    }
    const list = top.map(({ v, score: sc }) => { const d = v >= n ? ov.docs.get(v - n) : new SegDoc(seg, v); const rb = d.rb; return { path: d.path, heading: d.heading, line: d.line, snippet: d.snippet, score: round3(sc), project: d.project, ...(rb ? { review_by: rb } : {}) }; });
    return Object.defineProperty(list, 'total', { value: total, writable: true, configurable: true });
  }
  _tfOf(d, t) {
    if (d instanceof SegDoc) { if (!t.e) return 0; if (!t.checked) { const ids = t.ids || (t.ids = this.seg.ids(t.e)); t.tfs = t.tfs || this.seg.tfs(t.e); this.seg.checkList(t.e, ids, t.tfs); t.checked = true; } const ids = t.ids; let lo = 0, hi = t.e.df - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (ids[m] === d.i) return (t.tfs || (t.tfs = this.seg.tfs(t.e)))[m]; if (ids[m] < d.i) lo = m + 1; else hi = m - 1; } return 0; }
    return t.ot === undefined ? 0 : RecallIndex._tf(d, t.ot);
  }
  explain(q, d, o = {}) { return this._asking(() => this._explain(q, d, o)); }
  _explain(q, d, { project = null, boosts = null } = {}) {
    const { words, all, terms, N, avg } = this._plan(q, true); const used = new Set(terms.map((t) => t.w)); const byW = new Map(all.map((t) => [t.w, t])); const parts = []; let base = 0;
    for (const w of words) { const t = byW.get(w); const f = t ? this._tfOf(d, t) : 0; if (!t || !f) { parts.push({ word: w, in_section: 0, contribution: 0, note: !t ? 'not in any note' : 'not in this section' }); continue; } if (!used.has(w)) { parts.push({ word: w, in_section: f, sections_with_word: t.df, contribution: 0, note: 'too common to count (in over a third of all sections)' }); continue; } const { idf, part } = RecallIndex._bm(f, t.df, N, d.len, avg); base += part; parts.push({ word: w, in_section: f, sections_with_word: t.df, weight: round3(idf), contribution: round3(part) }); }
    parts.sort((a, b) => b.contribution - a.contribution); const pj = project ? String(project).toLowerCase() : null; const fp = pj && d.project === pj ? 1.5 : 1, fb = boosts?.[`${d.path}#${d.heading || ''}`] ?? 1;
    return { score: round3(base * fp * fb), words: parts, matched: parts.filter((p) => p.contribution > 0).map((p) => p.word), dropped_common: all.filter((t) => !used.has(t.w)).map((t) => t.w), section_words: d.len, average_section_words: Number(avg.toFixed(1)), project_multiplier: fp, feedback_multiplier: round3(fb) };
  }
}
