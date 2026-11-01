// SPDX-License-Identifier: Apache-2.0
// Fixtures for test/oplog-lock-cli.test.mjs (SR-1.01 task 3): a sandbox vault with its daemon stopped, a child process that holds
// the vault's op log lock the way a second writer would, the daemon started by hand so its exit code can be read, and byte-level
// snapshots of the op log folder.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { sandbox, initWithRetry } from './cli.mjs';
import { PKG } from './tmp.mjs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const MAIN = path.join(PKG, 'src', 'server', 'main.mjs');
const VAULT = pathToFileURL(path.join(PKG, 'src', 'engine', 'vault.mjs')).href;

/** A sandbox with an initialised vault and no daemon running. */
export function initSandbox({ ports = 1 } = {}) {
  const sb = sandbox({ ports });
  const r = initWithRetry(sb, ['init', '--port', String(sb.port), '--local-only', '--no-connect']);
  if (r.code !== 0) throw new Error(`init failed: ${r.out}${r.err}`);
  const s = sb.run(['stop']);
  if (s.code !== 0) throw new Error(`stop failed: ${s.out}${s.err}`);
  return { ...sb, state: path.join(sb.root, '.memev'), oplog: path.join(sb.root, '.memev', 'oplog'), lock: path.join(sb.root, '.memev', 'oplog', 'LOCK') };
}

/** Run a short script as a child that opens this sandbox's vault; its stdout comes back parsed as JSON. */
export function inVault(sb, body) {
  const src = `import { Vault } from '${VAULT}';\nconst OWNER = { id: 'test', agent: 'test', scopes: ['read', 'write', 'admin'], paths: ['**'] };\n${body}`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', src], { env: sb.env, encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) throw new Error(`child failed (${r.status}): ${r.stderr}`);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

/** Put `notes` notes in the vault's log, in segments of `segmentBytes` when given. Run while no daemon holds the vault. */
export function seed(sb, { notes = 3, segmentBytes } = {}) {
  inVault(sb, `const v = new Vault(${JSON.stringify(sb.root)}, { git: false, fsync: false${segmentBytes ? `, segmentBytes: ${segmentBytes}` : ''} }).open();
for (let i = 1; i <= ${notes}; i++) v.write(OWNER, { path: 'notes/seed-' + i + '.md', body: 'seed ' + i + ' ' + 'x'.repeat(${segmentBytes ? 80 : 0}) + '\\n' });
v.close();`);
}
export const notePath = (sb, n = 1) => path.join(sb.root, 'notes', `seed-${n}.md`);

/** Every file under `dir`, relative name to { sha, size }, so a changed, added or removed file shows. */
export function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else { const b = fs.readFileSync(f); out[path.relative(dir, f)] = { sha: crypto.createHash('sha256').update(b).digest('hex'), size: b.length }; }
    }
  };
  walk(dir);
  return out;
}

/** Every record in the op log's segments (the active folder and the archive), parsed. */
export function records(oplogDir) {
  const out = [];
  for (const d of [oplogDir, path.join(oplogDir, 'archive')]) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.jsonl')).sort()) {
      for (const line of fs.readFileSync(path.join(d, f), 'utf8').split('\n')) { try { out.push(JSON.parse(line)); } catch { /* a torn line or blank */ } }
    }
  }
  return out;
}

const live = new Set();
export function killAll() { for (const p of live) { try { process.kill(p, 'SIGKILL'); } catch {} } live.clear(); }

/**
 * A child process that opens the vault writable and holds it until told to stop. Resolves once it holds the lock, with
 * { pid, stop(), kill9() }.
 */
export async function holder(sb) {
  const src = `import { Vault } from '${VAULT}';
const v = new Vault(${JSON.stringify(sb.root)}, { git: false, fsync: false }).open();
process.stdout.write('open ' + process.pid + '\\n');
process.stdin.resume(); process.stdin.on('end', () => { try { v.close(); } catch {} process.exit(0); });`;
  const p = spawn(process.execPath, ['--input-type=module', '-e', src], { env: sb.env, stdio: ['pipe', 'pipe', 'pipe'] });
  live.add(p.pid);
  let err = '';
  p.stderr.on('data', (d) => { err += d; });
  const exited = new Promise((r) => p.on('exit', (code, sig) => { live.delete(p.pid); r({ code, sig }); }));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`the holder did not open the vault: ${err}`)), 20000);
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d) => { if (String(d).startsWith('open')) { clearTimeout(t); resolve(); } });
    exited.then(() => { clearTimeout(t); reject(new Error(`the holder exited: ${err}`)); });
  });
  return {
    pid: p.pid,
    async stop() { try { p.stdin.end(); } catch {} await exited; },
    async kill9() { p.kill('SIGKILL'); await exited; },
  };
}

/** A process that is alive and is not a Memev daemon. */
export function sleeper() {
  const p = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  live.add(p.pid); p.on('exit', () => live.delete(p.pid));
  return { pid: p.pid, kill() { try { p.kill('SIGKILL'); } catch {} } };
}

/**
 * The daemon started by hand (node src/server/main.mjs --root R): { pid, exited (a promise of { code, ms }), stderr() }.
 * `env` is added to the sandbox's environment.
 */
export function rawDaemon(sb, env = {}) {
  const t0 = Date.now();
  const p = spawn(process.execPath, [MAIN, '--root', sb.root], { env: { ...sb.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  live.add(p.pid);
  let stderr = '';
  p.stderr.on('data', (d) => { stderr += d; }); p.stdout.on('data', () => {});
  const exited = new Promise((r) => p.on('exit', (code, sig) => { live.delete(p.pid); r({ code, sig, ms: Date.now() - t0 }); }));
  // `exited` as it settles, or { code: null, timedOut: true } after `ms`: a daemon that never exits fails the test and does not hang it
  const exitedWithin = (ms) => Promise.race([exited, sleep(ms).then(() => ({ code: null, timedOut: true }))]);
  return { pid: p.pid, exited, exitedWithin, stderr: () => stderr, kill: () => { try { p.kill('SIGKILL'); } catch {} } };
}

/** Wait until this vault's daemon answers /healthz (true) or `ms` pass (false). */
export async function waitHealthy(sb, ms = 10000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(`http://127.0.0.1:${sb.port}/healthz`, { signal: AbortSignal.timeout(500) }); if (r.ok && (await r.json()).ok === true) return true; } catch { /* not up yet */ }
    await sleep(50);
  }
  return false;
}
export async function answers(sb) {
  try { const r = await fetch(`http://127.0.0.1:${sb.port}/healthz`, { signal: AbortSignal.timeout(500) }); return r.ok; } catch { return false; }
}

/** A write over HTTP with the admin token: { status, body } (status 0 when the daemon did not answer). */
export async function httpWrite(sb, file, body = 'written over http\n') {
  const token = JSON.parse(fs.readFileSync(path.join(sb.state, 'admin.json'), 'utf8')).token;
  try {
    const r = await fetch(`http://127.0.0.1:${sb.port}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memev_write', arguments: { path: file, body } } }), signal: AbortSignal.timeout(5000) });
    const j = await r.json().catch(() => null);
    return { status: j?.error || j?.result?.isError ? 500 : r.status, body: j };
  } catch (e) { return { status: 0, body: String(e) }; }
}

/** Hold a TCP port on loopback; resolves a handle with close(). */
export function holdPort(port) {
  return new Promise((resolve, reject) => {
    const s = net.createServer((c) => c.destroy());
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => resolve({ close: () => new Promise((r) => s.close(r)) }));
  });
}

/** Swap in a lock that carries another token, by rename, the way a recoverer does. Returns the new bytes. */
export function stealLock(sb) {
  const cur = JSON.parse(fs.readFileSync(sb.lock, 'utf8'));
  const bytes = JSON.stringify({ ...cur, token: crypto.randomBytes(16).toString('hex') });
  const tmp = `${sb.lock}.test-${process.pid}`;
  fs.writeFileSync(tmp, bytes, { mode: 0o600 });
  fs.renameSync(tmp, sb.lock);
  return bytes;
}

/** Poll for `file` every 5 ms in a child process; resolves { stop() -> { seen } }. */
export async function pollFor(file) {
  const src = `import fs from 'node:fs'; let seen = false; const f = ${JSON.stringify(file)};
const t = setInterval(() => { if (fs.existsSync(f)) seen = true; }, 5);
process.stdout.write('polling\\n');
process.stdin.resume(); process.stdin.on('end', () => { clearInterval(t); process.stdout.write(JSON.stringify({ seen }) + '\\n'); process.exit(0); });`;
  const p = spawn(process.execPath, ['--input-type=module', '-e', src], { stdio: ['pipe', 'pipe', 'inherit'] });
  live.add(p.pid);
  let out = '';
  p.stdout.setEncoding('utf8'); p.stdout.on('data', (d) => { out += d; });
  const done = new Promise((r) => p.on('exit', () => { live.delete(p.pid); r(); }));
  while (!out.includes('polling')) await sleep(5);
  return { async stop() { p.stdin.end(); await done; return JSON.parse(out.trim().split('\n').pop()); } };
}
