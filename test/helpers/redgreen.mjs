// Fixtures for the red-green verifier tests (SR-0.03 task 3): a git repository whose commits are the base and the head, a
// contract with one red-green criterion signed against an explicit base, verify run in this process or in a child process
// that can be killed mid-run, and the worktrees git lists.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir, OWNER, PKG } from './tmp.mjs';

const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false'];
export const gitIn = (dir, ...args) => execFileSync('git', ['-C', dir, ...ID, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
/** Write `files` ({ path: text, or null to delete }) in `dir` and commit; returns the new HEAD. */
export function commit(dir, files, message = 'change') {
  for (const [p, t] of Object.entries(files)) {
    const f = path.join(dir, p);
    if (t === null) fs.rmSync(f, { force: true, recursive: true });
    else { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t, { mode: p.endsWith('.sh') ? 0o755 : 0o644 }); }
  }
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '--allow-empty', '-m', message);
  return gitIn(dir, 'rev-parse', 'HEAD');
}
/** A repository whose first commit (the base) holds `base` and whose second (the head) applies `head`. */
export function baseAndHead(base, head) {
  const dir = fs.realpathSync(tmpdir('rg-repo-'));
  gitIn(dir, 'init', '-q');
  const b = commit(dir, base, 'base');
  const h = commit(dir, head, 'head');
  return { dir, base: b, head: h };
}
/** A node test file that asserts `expr` (code evaluated in the test, after `imports`). */
export const nodeTest = (expr, imports = '', name = 'the behaviour') => `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n${imports}\ntest(${JSON.stringify(name)}, async () => { ${expr} });\n`;
/** A criterion running `cmd` ({test} is the test file) against `test_file`, with extra verifier fields. */
export const redGreen = (test_file, cmd = 'node --test {test}', extra = {}) => ({ statement: 'red on the base, green on the head', verifier: { type: 'test_red_green', test_file, cmd, ...extra } });
/** Draft and sign, locally, a contract with these criteria against the explicit base; returns its id. */
export function signed(v, { workdir, base, criteria, local = true }) {
  const d = v.contractDraft(OWNER, { title: 'Red green fixture', workdir, base, tasks: [{ id: 'T1', title: 'the change', scope: ['**'], criteria }] });
  v.contractSign(OWNER, { id: d.id, local });
  return d.id;
}
/** The first criterion's result of a verify. */
export const first = (r) => r.tasks[0].criteria[0];
/** The worktree paths git lists for the repository. */
export const worktrees = (dir) => gitIn(dir, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9));
/** The worktree blocks git lists, each { path, lines }. */
export const worktreeBlocks = (dir) => gitIn(dir, 'worktree', 'list', '--porcelain').split(/\n\n+/).map((b) => ({ path: b.split('\n')[0].slice(9), lines: b.split('\n') }));
/** The engine's own temporary worktrees git lists for the repository. */
export const engineWorktrees = (dir) => worktrees(dir).filter((p) => /^memev-verify-\d+-[0-9a-f]+$/.test(path.basename(p)));

const CHILD = `
import { initVault, Vault } from ${JSON.stringify(path.join(PKG, 'src/engine/vault.mjs'))};
const [root, keys, spec] = process.argv.slice(2);
const OWNER = { id: 'test', agent: 'test', scopes: ['read', 'write', 'admin'], paths: ['**'] };
initVault(root, { template: ${JSON.stringify(path.join(PKG, 'templates', 'vault'))} });
const v = new Vault(root, { git: false, fsync: false, keyDir: keys }).open();
const s = JSON.parse(spec);
const d = v.contractDraft(OWNER, { title: 'Child fixture', workdir: s.workdir, base: s.base, tasks: [{ id: 'T1', title: 'the change', scope: ['**'], criteria: s.criteria }] });
v.contractSign(OWNER, { id: d.id });
process.stdout.write('signed\\n');
const r = await v.contractVerify(OWNER, { id: d.id });
process.stdout.write(JSON.stringify(r.tasks[0].criteria[0]) + '\\n');
v.close();
`;
/**
 * Verify in a child process with its own vault: { child, result } where result resolves to the first criterion's result (or
 * null when the child dies first).
 */
export function childVerify({ workdir, base, criteria }) {
  const dir = tmpdir('rg-child-');
  const script = path.join(dir, 'verify.mjs');
  fs.writeFileSync(script, CHILD);
  const child = spawn(process.execPath, [script, path.join(dir, 'vault'), path.join(dir, 'keys'), JSON.stringify({ workdir, base, criteria })], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (b) => { out += b; });
  child.stderr.on('data', (b) => { out += b; });
  const result = new Promise((res) => child.on('close', () => { const line = out.split('\n').find((l) => l.startsWith('{')); try { res(line ? JSON.parse(line) : null); } catch { res(null); } }));
  return { child, result, output: () => out };
}
/** Wait until `pred()` holds, checking every 50 ms, for at most `ms`. */
export async function until(pred, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return false;
}
/** SIGKILL a verify once its temporary worktree exists, leaving that worktree stale; returns its path. */
export async function killMidRun(dir, base, criteria) {
  const before = new Set(engineWorktrees(dir));
  const c = childVerify({ workdir: dir, base, criteria });
  let wt = null;
  const seen = await until(() => { wt = engineWorktrees(dir).find((p) => !before.has(p) && fs.existsSync(p)) || null; return !!wt; });
  c.child.kill('SIGKILL');
  await c.result;
  assert.ok(seen, `the verify never added its worktree: ${c.output()}`);
  return wt;
}
