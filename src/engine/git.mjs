// SPDX-License-Identifier: Apache-2.0
// Git as the durable, human-readable history. Writes are batched: one commit per quiet period.
import { MessageChannel, SHARE_ENV, Worker, receiveMessageOnPort } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import { run, replacePrivate, readPrivate } from './util.mjs';

// Every git command in this process waits for the commit queue's running batch, so nothing here ever races it.
export function git(root, args, opts = {}) {
  settleFlights();
  const r = run('git', args, { cwd: root, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(opts.env || {}) }, input: opts.input });
  return { ok: r.ok, status: r.status, out: r.stdout.trim(), err: r.stderr.trim() || r.error || '' };
}

// git init -b main needs git 2.28; on older git, fall back to a plain init and move HEAD by hand.
export function gitInitMain(root) {
  let r = git(root, ['init', '-q', '-b', 'main']);
  if (r.ok) return r;
  r = git(root, ['init', '-q']);
  if (!r.ok) return r;
  return git(root, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
}

// One commit: stage the paths, drop an empty batch, commit. `g` runs git; the background thread and flush() share this, so the two
// cannot drift. It takes everything it needs by argument because its source is also the background thread's.
function commitBatch(g, paths, clients, missing) {
  let a = g(['add', '-A', '--', ...paths]);
  if (!a.ok) {
    // a note written and deleted inside one quiet period is on no disk and in no index, and naming it fails the whole add: drop only that
    const known = paths.filter((p) => !missing(p) || g(['ls-files', '--', p]).out);
    if (known.length === paths.length) return a;
    if (!known.length) return null;
    paths = known;
    a = g(['add', '-A', '--', ...paths]);
    if (!a.ok) return a;
  }
  // an edit undone before the flush (or a path a merge already committed) leaves nothing to commit; drop it
  // instead of failing every flush on "nothing to commit"
  if (g(['diff', '--cached', '--quiet', '--', ...paths]).ok) return null;
  const subject = paths.length === 1 ? `memev: ${paths[0]}` : `memev: ${paths.length} notes`;
  const body = clients.length ? `\n\nMemev-Client: ${[...clients].sort().join(', ')}` : '';
  return g(['commit', '-q', '-m', `${subject}${body}`]);
}

const COMMIT_THREAD = `
const { workerData } = require('node:worker_threads');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs'); const path = require('node:path');
const commitBatch = ${commitBatch.toString()};
const { port, settled } = workerData; const count = new Int32Array(settled);
port.on('message', ({ id, root, paths, clients }) => {
  let result;
  try {
    const g = (args) => {
      // no preload: its threads spend every core on lstat for about 75 ms less git time, and that starves the daemon's own thread
      const r = spawnSync('git', ['-c', 'core.preloadIndex=false', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
      if (r.error) return { ok: false, status: null, out: '', err: r.error.message };
      return { ok: r.status === 0, status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
    };
    result = commitBatch(g, paths, clients, (p) => !fs.existsSync(path.join(root, ...p.split('/'))));
  } catch (e) { result = { ok: false, status: null, out: '', err: e.message }; }
  port.postMessage({ id, result });
  Atomics.add(count, 0, 1); Atomics.notify(count, 0);
});`;

// The background thread, one per process and started by the first timed commit, so a command that only ever calls flush() never
// starts it. Batches run one at a time, in the order sent. Waiting for one uses Atomics, so flush() and git() can stay synchronous.
let thread; // undefined: not started; null: could not start, so commits stay on the caller's thread
const flights = new Map();
function commitThread() {
  if (thread !== undefined) return thread;
  try {
    const { port1, port2 } = new MessageChannel();
    const settled = new SharedArrayBuffer(4);
    const worker = new Worker(COMMIT_THREAD, { eval: true, env: SHARE_ENV, execArgv: [], workerData: { port: port2, settled }, transferList: [port2] });
    worker.on('error', () => { thread = null; endFlights('the commit thread stopped'); });
    worker.unref(); port1.on('message', settle); port1.unref();
    thread = { worker, port: port1, count: new Int32Array(settled), next: 1 };
  } catch { thread = null; }
  return thread;
}
function settle({ id, result }) { const f = flights.get(id); if (f) { flights.delete(id); f(result); } }
function endFlights(why) { const fs = [...flights.values()]; flights.clear(); for (const f of fs) f({ ok: false, status: null, out: '', err: why }); }
const WAIT_LIMIT_MS = 120000;
/** Wait, blocking this thread, until no batch is running, so whatever runs next sees every commit made so far and never meets git's index lock. */
function settleFlights() {
  if (!flights.size) return;
  const end = Date.now() + WAIT_LIMIT_MS;
  while (flights.size) {
    const seen = Atomics.load(thread.count, 0);
    let m; while (flights.size && (m = receiveMessageOnPort(thread.port))) settle(m.message);
    if (!flights.size) return;
    const left = end - Date.now();
    if (left <= 0 || Atomics.wait(thread.count, 0, seen, left) === 'timed-out') {
      // a git that hangs past the limit: the batch goes back to pending, and the next commit reports what git says
      endFlights('the commit did not finish in time'); return;
    }
  }
}

export class CommitQueue {
  constructor(root, { delayMs = 400, enabled = true, background = true } = {}) { this.root = root; this.delayMs = delayMs; this.enabled = enabled; this.background = background; this.pending = new Map(); this.flying = null; this.timer = null; this.commits = 0; }
  add(p, client) {
    if (!this.enabled) return;
    if (!this.pending.has(p)) this.pending.set(p, new Set());
    if (client) this.pending.get(p).add(client);
    this._arm();
  }
  _arm() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._quiet(), this.delayMs);
    this.timer.unref?.();
  }
  /** The quiet period ended: commit on the background thread. One batch at a time; what arrives meanwhile waits for the next. */
  _quiet() {
    this.timer = null;
    if (this.flying) return; // its end arms the timer again
    if (!this.pending.size) return;
    const t = this.background ? commitThread() : null;
    if (!t) { this.flush(); return; }
    const batch = this.pending; this.pending = new Map(); this.flying = batch;
    const id = t.next++; const seq = this.log?.seq;
    flights.set(id, (result) => this._landed(batch, result, seq));
    t.port.postMessage({ id, root: this.root, paths: [...batch.keys()], clients: [...new Set([...batch.values()].flatMap((s) => [...s]))] });
  }
  _landed(batch, result, seq) {
    this.flying = null;
    if (this.pending.size && !this.timer) this._arm(); // what arrived during the batch
    if (result?.ok) this.commits++;
    if (!result || result.ok) this._markCommitted(seq);
    // keep the paths on failure so the next commit retries them; only a committed batch drops them
    else for (const [p, cs] of batch) { const have = this.pending.get(p); if (have) for (const c of cs) have.add(c); else this.pending.set(p, cs); }
  }
  /** Commit everything now, on this thread, after any batch still running. The result is that of this call's own commit. */
  flush() {
    clearTimeout(this.timer); this.timer = null;
    settleFlights();
    if (!this.pending.size) { this._markCommitted(this.log?.seq); return null; }
    const seq = this.log?.seq;
    const paths = [...this.pending.keys()]; const clients = [...new Set([...this.pending.values()].flatMap((s) => [...s]))];
    const r = commitBatch((args) => git(this.root, args), paths, clients, (p) => !fs.existsSync(path.join(this.root, ...p.split('/')))); this.flushedAt = Date.now();
    if (r === null) { this.pending.clear(); this._markCommitted(seq); return null; }
    // keep the paths pending on failure so the next flush retries them; only a committed flush drops them
    if (r.ok) { this.pending.clear(); this.commits++; this._markCommitted(seq); }
    return r;
  }
  /**
   * A hard kill loses what is pending, and nothing else would ever commit those notes. The op log already holds them, durably, so the
   * only new record is how far commits have reached: a file written after each commit, never synced, because an old value only means
   * a path is looked at again and an empty batch is dropped. On open, every path the log has past that point is queued again, with bus/,
   * whose files are not in the log. The queue's timer does it, so the bus's seed commit, made before this, stays first and on its own.
   */
  catchUp(log, file) {
    if (!this.enabled) return;
    this.log = log; this.markFile = file;
    const text = readPrivate(file); const saved = text === null ? NaN : Number(text.trim()); // no record yet: nothing to compare with
    if (text === null || !Number.isSafeInteger(saved) || saved < 0 || saved > log.seq) { this._markCommitted(log.seq); return; }
    const late = []; for (const [p, h] of log.heads) if (h.seq > saved) late.push(p);
    // past the command line's room (Windows has the least), name the top folders
    const names = late.length > 400 ? [...new Set(late.map((p) => p.split('/')[0]))] : late;
    for (const p of names) this.add(p, null);
    if (late.length || this._busSince(file)) this.add('bus', null);
  }
  /** A bus file newer than the commit record. The bus is not in the op log, so its message before a hard kill shows only here. A pulse is committed at its own pace and does not count. */
  _busSince(markFile) {
    let mark; try { mark = fs.statSync(markFile).mtimeMs; } catch { return false; }
    mark = Math.max(mark, this.flushedAt || 0); // the bus's own seed commit, made just before this
    const bus = path.join(this.root, 'bus'); const newer = (f) => { try { return fs.statSync(f).mtimeMs > mark; } catch { return false; } };
    if (newer(path.join(bus, 'operator.json'))) return true;
    for (const d of ['log', 'seats']) { let names = []; try { names = fs.readdirSync(path.join(bus, d)); } catch { /* none yet */ } for (const n of names) if (newer(path.join(bus, d, n))) return true; }
    return false;
  }
  _markCommitted(seq) {
    if (!this.markFile || seq === undefined) return;
    try { replacePrivate(this.markFile, String(seq)); } catch { /* the next commit writes it again */ }
  }
}
