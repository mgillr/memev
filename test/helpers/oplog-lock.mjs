// SPDX-License-Identifier: Apache-2.0
// Fixtures for test/oplog-lock.test.mjs (SR-1.01 task 1): a vault on disk, child processes that hold or open it (the way
// memev claims does), byte-level snapshots of the op log folder, and the lock file's fields.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir, OWNER, PKG } from './tmp.mjs';
import { initVault, Vault } from '../../src/engine/vault.mjs';

export { OWNER, PKG, tmpdir };
export const CHILD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'oplog-lock', 'child.mjs');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A vault with `notes` notes in its log, closed again; returns { root, dir (the op log folder), lock (the LOCK path) }. */
export function makeVault({ notes = 3, git = false, segmentBytes } = {}) {
  const root = path.join(fs.realpathSync(tmpdir('oplock-')), 'vault');
  return seed(root, { notes, git, segmentBytes });
}
function seed(root, { notes, git, segmentBytes }) {
  initVault(root, { template: path.join(PKG, 'templates', 'vault') });
  const v = new Vault(root, { git, fsync: false, segmentBytes, keyDir: path.join(root, '..', 'keys') }).open();
  for (let i = 1; i <= notes; i++) v.write(OWNER, { path: `notes/seed-${i}.md`, body: `seed ${i}\n` });
  v.close();
  const dir = path.join(root, '.memev', 'oplog');
  return { root, dir, lock: path.join(dir, 'LOCK') };
}
/** Open the vault writable in this process. */
export const openVault = (root, opts = {}) => new Vault(root, { git: false, fsync: false, keyDir: path.join(root, '..', 'keys'), ...opts }).open();

const live = new Set();
/** Kill every child still running (a failed assertion leaves some behind, and they hold the test process open). */
export function killAll() { for (const c of live) { try { c.proc.kill('SIGKILL'); } catch {} } live.clear(); }
/** A child process: events arrive on stdout, commands go to stdin. */
export class Child {
  constructor(spec, { env = {} } = {}) {
    this.events = []; this.waiters = []; this.out = '';
    this.proc = spawn(process.execPath, [CHILD, JSON.stringify(spec)], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.pid = this.proc.pid; this.stderr = ''; live.add(this);
    this.proc.stderr.on('data', (d) => { this.stderr += d; });
    this.proc.stdin.on('error', () => {});
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (d) => {
      this.out += d;
      let i;
      while ((i = this.out.indexOf('\n')) >= 0) { const l = this.out.slice(0, i); this.out = this.out.slice(i + 1); if (l.trim()) this._push(JSON.parse(l)); }
    });
    this.exited = new Promise((r) => this.proc.on('exit', (code, sig) => { this.code = code; this.signal = sig; this._push({ event: 'exit', code, signal: sig }); live.delete(this); r({ code, sig }); }));
  }
  _push(e) { this.events.push(e); for (const w of [...this.waiters]) w(); }
  /** The first event, from the ones not yet taken, that satisfies `pred`. */
  next(pred = () => true, ms = 30000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no event within ${ms} ms; got ${JSON.stringify(this.events)}; stderr: ${this.stderr}`)), ms);
      const look = () => {
        const i = this.events.findIndex(pred);
        if (i < 0) return false;
        clearTimeout(t); this.waiters.splice(this.waiters.indexOf(look), 1);
        resolve(this.events.splice(i, 1)[0]); return true;
      };
      if (!look()) this.waiters.push(look);
    });
  }
  /** The child's answer: its open event, or the refusal that ended it. */
  opened() { return this.next((e) => e.event === 'open' || e.event === 'refused'); }
  /** Send a command and wait for its reply. */
  async send(cmd) {
    this.proc.stdin.write(`${JSON.stringify(cmd)}\n`);
    return this.next((e) => e.event === 'reply' && e.cmd === cmd.cmd);
  }
  async kill9() { this.proc.kill('SIGKILL'); await this.exited; }
  async stop() { if (this.code === undefined && !this.signal) { try { this.proc.stdin.write('{"cmd":"exit"}\n'); } catch {} } await this.exited; }
}
/** A child that opens writable and waits for commands; resolves once it holds the vault. */
export async function holder(root, spec = {}, env = {}) {
  const c = new Child({ root, kind: 'vault', wait: true, ...spec }, { env });
  const r = await c.opened();
  if (r.event !== 'open') throw new Error(`the holder was refused: ${JSON.stringify(r)}`);
  return c;
}
/** Run an opener child to its end and return its first answer (open or refused). */
export async function tryOpen(root, spec = {}, env = {}) {
  const c = new Child({ root, kind: 'vault', hold: 1, ...spec }, { env });
  const r = await c.opened();
  await c.exited;
  return r;
}

/** { relative path: { sha, size, mtimeMs } } of every file under `dir`, recursively. */
export function tree(dir) {
  const out = {};
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(f, r);
      else { const st = fs.statSync(f); out[r] = { sha: crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'), size: st.size, mtimeMs: st.mtimeMs }; }
    }
  };
  walk(dir, '');
  return out;
}
/** The same, without mtimes: what "byte-identical" compares. */
export const bytes = (dir) => Object.fromEntries(Object.entries(tree(dir)).map(([k, v]) => [k, `${v.sha}:${v.size}`]));
/** sha256:size of each named file under `root` ('' for a missing one). */
export function files(root, rels) {
  const out = {};
  for (const r of rels) { try { const b = fs.readFileSync(path.join(root, r)); out[r] = `${crypto.createHash('sha256').update(b).digest('hex')}:${b.length}`; } catch { out[r] = ''; } }
  return out;
}
export const STATE_FILES = ['.memev/index.jsonl', '.memev/graph.json', '.memev/device.json', '.memev/devices.json'];

export const readLock = (lock) => JSON.parse(fs.readFileSync(lock, 'utf8'));
export const writeLock = (lock, o) => fs.writeFileSync(lock, typeof o === 'string' || Buffer.isBuffer(o) ? o : `${JSON.stringify(o)}\n`);
/** Set the lock's mtime `s` seconds in the past. */
export function age(lock, s) { const t = (Date.now() - s * 1000) / 1000; fs.utimesSync(lock, t, t); }
/** A lock the implementation wrote for this vault, as an object (a holder is started and stopped to get it). */
export async function sampleLock(root, lock) {
  const h = await holder(root);
  const o = readLock(lock);
  await h.stop();
  return o;
}
/** The pid of a node child that has already exited. */
export async function deadPid() {
  const c = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' });
  await new Promise((r) => c.on('exit', r));
  return c.pid;
}
/** This boot as a test works it out for itself. */
export const bootMs = () => Date.now() - os.uptime() * 1000;
export const isLocked = (e, pid) => !!e && (e.name === 'VaultLocked' || e.code === 'VaultLocked') && (pid === undefined || String(e.message).includes(String(pid)));
export function seqs(v) { return [...v.log.iterate()].map((r) => r.seq); }
export const consecutive = (a) => a.every((s, i) => s === i + 1);
/** Replace LOCK the way a recoverer would: write a lock with another token to a temp file and rename it over LOCK. Returns its bytes. */
export function stealLock(lock) {
  const o = { ...readLock(lock), token: crypto.randomBytes(16).toString('hex') };
  const tmp = `${lock}.thief`;
  writeLock(tmp, o);
  fs.renameSync(tmp, lock);
  return fs.readFileSync(lock);
}
/** bytes(dir) without the LOCK file. */
export const bytesNoLock = (dir) => { const b = bytes(dir); delete b.LOCK; return b; };
