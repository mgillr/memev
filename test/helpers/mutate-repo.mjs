// SPDX-License-Identifier: Apache-2.0
// Fixture repositories for the mutation gate's tests (test/gate-mutate.test.mjs): a git repository built in a temporary
// folder from a map of files, the gate run on it as a child process, and hashes of a folder and of a repository's state.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const GATE = path.join(PKG, 'scripts', 'gate', 'mutate.mjs');

const made = [];
export function scratch(prefix = 'memev-mutate-test-') {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(d);
  return d;
}
export function cleanupScratch() { for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 }); }

// git for the fixtures: no system config, no optional index writes, a fixed author, and never another repository.
export function git(dir, ...args) {
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0' };
  for (const k of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_COMMON_DIR']) delete env[k];
  return execFileSync('git', args, { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
export function write(dir, files) {
  for (const [f, text] of Object.entries(files)) {
    const p = path.join(dir, f);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
}
// A repository with one commit holding files (and a package.json that makes .js files modules).
export function repo(files) {
  const dir = path.join(scratch(), 'work');
  fs.mkdirSync(dir);
  git(dir, 'init', '-q');
  const config = [['user.name', 't'], ['user.email', 't@example.invalid'], ['commit.gpgsign', 'false'], ['tag.gpgsign', 'false']];
  for (const [k, v] of config) git(dir, 'config', k, v);
  write(dir, { 'package.json': '{ "type": "module" }\n', ...files });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return { dir, base: git(dir, 'rev-parse', 'HEAD') };
}
// A source text whose changed lines end with //@. The base text keeps a comment on those lines; the changed text drops it,
// so exactly the marked lines differ between the two.
export function marked(text) {
  return { base: text.replace(/ *\/\/@$/gm, ' // before the change'), head: text.replace(/ *\/\/@$/gm, '') };
}
// The base commit holds the base text of src and the other files as they are; the changed text is then written to the
// working tree, and committed as a second commit when commit is true.
export function fixture({ src = {}, files = {}, commit = false }) {
  const base = {}, head = {};
  for (const [f, text] of Object.entries(src)) { const m = marked(text); base[f] = m.base; head[f] = m.head; }
  const r = repo({ ...files, ...base });
  write(r.dir, head);
  if (commit) { git(r.dir, 'add', '-A'); git(r.dir, 'commit', '-q', '-m', 'change'); }
  return r;
}

// Runs scripts/gate/mutate.mjs in dir. env adds variables to this process's environment; a variable set to undefined
// is removed. onSpawn sees the child as soon as it starts.
export function runGate(dir, args, { env = {}, timeoutMs = 300000, onSpawn } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const full = { ...process.env };
    delete full.NODE_TEST_CONTEXT; // the fixtures' own test commands report on their own, not to this runner
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete full[k]; else full[k] = v; }
    const child = spawn(process.execPath, [GATE, ...args], { cwd: dir, env: full, stdio: ['ignore', 'pipe', 'pipe'] });
    onSpawn?.(child);
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      let json = null;
      try { json = JSON.parse(out); } catch { json = null; }
      resolve({ code, signal, out, err, json, ms: Date.now() - t0 });
    });
  });
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
// Every file under dir (the .git folder included) by relative path, with the hash of its bytes or its link target.
export function hashTree(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const rel = path.relative(dir, p);
      if (e.isSymbolicLink()) out[rel] = `link:${fs.readlinkSync(p)}`;
      else if (e.isDirectory()) { out[`${rel}/`] = 'dir'; walk(p); }
      else out[rel] = sha(fs.readFileSync(p));
    }
  };
  walk(dir);
  return out;
}
export function gitState(dir) {
  return {
    config: fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8'),
    refs: git(dir, 'for-each-ref'),
    head: git(dir, 'rev-parse', 'HEAD'),
    worktrees: git(dir, 'worktree', 'list', '--porcelain'),
    status: git(dir, 'status', '--porcelain'),
  };
}
export const fileSha = (file) => sha(fs.readFileSync(file));
export const readLog = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
export const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export async function waitFor(fn, ms = 60000, step = 50) {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (fn()) return true; await new Promise((r) => setTimeout(r, step)); }
  return fn();
}
// path is inside dir (or is dir).
export function inside(p, dir) { const rel = path.relative(dir, p); return !rel.startsWith('..') && !path.isAbsolute(rel); }
