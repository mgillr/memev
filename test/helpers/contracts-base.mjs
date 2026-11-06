// Fixtures for the base revision tests (SR-0.03 task 1): a git workdir with commits, a contract signed by hand the way an
// older engine or a forger would write one, a vault served over HTTP with a local token and an enrolled remote computer, and
// a stand-in git that leaves a marker whenever it runs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { newVault, tmpdir, OWNER } from './tmp.mjs';
import { sign as dsseSign, keyId } from '../../vendor/attest/signature.mjs';
import { signLicense, loadLicense } from '../../src/engine/license.mjs';
import { seatPolicy } from '../../src/engine/entitlements.mjs';
import { deviceKeygen } from '../../src/engine/devices.mjs';
import { createServer } from '../../src/server/http.mjs';
import { remoteFetch, deviceKeyFile } from '../../src/cli/remote.mjs';
import { writePrivate } from '../../src/engine/util.mjs';

const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false'];
/** git in `dir`, with a fixed identity and no signing; returns trimmed stdout. */
export const gitIn = (dir, ...args) => execFileSync('git', ['-C', dir, ...ID, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A new git repository with one commit holding `files` ({ path: text }); returns { dir, head }. */
export function gitRepo(files = { 'README.md': 'start\n' }, prefix = 'base-wd-') {
  const dir = fs.realpathSync(tmpdir(prefix));
  gitIn(dir, 'init', '-q');
  commit(dir, files, 'start');
  return { dir, head: gitIn(dir, 'rev-parse', 'HEAD') };
}
/** Write `files` in `dir` and commit them; returns the new HEAD. */
export function commit(dir, files, message = 'change') {
  for (const [p, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), t); }
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', message);
  return gitIn(dir, 'rev-parse', 'HEAD');
}

/** One task with the given criteria and scope, as contractDraft takes it. */
export const task = (criteria, scope = ['src/**']) => [{ id: 'T1', title: 'the work', scope, criteria }];

/**
 * A contract written straight into contracts/signed with its own key under contracts/keys, as an engine without bases (or a
 * forger) signs it with vendor/attest/signature.mjs. `fields` are merged into the body (base, origin, ...).
 */
export function signByHand(root, { id = `k-legacy-${crypto.randomBytes(3).toString('hex')}`, workdir, tasks, fields = {} }) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  const c = { schema: 'attest-contract/1', project: 'api', id, title: 'Signed by hand', workdir, created: new Date().toISOString(), version: 1, tasks: tasks.map((t) => ({ phase: 'implement', depends_on: [], requirements: [], description: '', stop_rules: [], ...t })), origin: 'local', ...fields };
  const env = dsseSign(c, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const kid = keyId(pub);
  for (const d of ['signed', 'keys']) fs.mkdirSync(path.join(root, 'contracts', d), { recursive: true });
  fs.writeFileSync(path.join(root, 'contracts', 'keys', `${kid}.pub`), pub);
  fs.writeFileSync(path.join(root, 'contracts', 'signed', `${id}.json`), `${JSON.stringify(c, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'contracts', 'signed', `${id}.sig.json`), `${JSON.stringify(env, null, 2)}\n`);
  return { id, contract: c };
}

/** The signed body of contract `id`, as written in the vault. */
export const signedBody = (root, id) => JSON.parse(fs.readFileSync(path.join(root, 'contracts', 'signed', `${id}.json`), 'utf8'));
/** The criterion results of task T1 of a verify result, by statement. */
export const byStatement = (r) => Object.fromEntries((r.tasks[0]?.criteria || []).map((cr) => [cr.statement, cr]));

/**
 * A folder holding an executable named git that appends one line to `marker` and then runs the real git. Put it first on
 * PATH to see whether anything ran git.
 */
export function gitSpy(marker) {
  const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const dir = tmpdir('git-spy-');
  fs.writeFileSync(path.join(dir, 'git'), `#!/bin/sh\necho "$*" >> '${marker}'\nexec '${real}' "$@"\n`, { mode: 0o755 });
  return dir;
}

const vendor = (() => { const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519'); return { pem: privateKey.export({ type: 'pkcs8', format: 'pem' }), keys: { 'test-vendor': publicKey.export({ type: 'spki', format: 'der' }).toString('base64') } }; })();
const day = (o) => new Date(Date.now() + o * 86400e3).toISOString().slice(0, 10);
const rpc = (name, args) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
function unwrap(j, status) {
  if (!j?.result) { const e = new Error(j?.error_description || j?.error?.message || `status ${status}`); e.status = status; throw e; }
  if (j.result.isError) { const e = new Error(j.result.content[0].text); e.status = status; throw e; }
  return j.result.structuredContent?.result ?? j.result.structuredContent;
}
/**
 * A vault served over HTTP, with `local(name, args)` calling an MCP tool with a local token from this computer and
 * `remote(name, args)` calling it as an enrolled remote computer would: signed with its device key, through a proxy header.
 */
export async function servedVault(opts = {}) {
  const { v, root } = newVault(opts);
  const conf = tmpdir('base-conf-');
  fs.writeFileSync(path.join(conf, 'license.json'), JSON.stringify(signLicense({ v: 1, lid: 'lic_base001', tier: 'team', services: ['sync'], seats: 3, iat: day(-10), exp: day(300), grace_days: 14 }, vendor.pem, 'test-vendor')));
  const env = { MEMEV_CONFIG_DIR: conf };
  const server = createServer(v, { tunnelKey: () => null, licenseKeys: vendor.keys, env });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const policy = () => seatPolicy({ license: loadLicense({ env, keys: vendor.keys }), devices: v.devices.list() });
  const cenv = { MEMEV_CONFIG_DIR: tmpdir('base-computer-') };
  const k = deviceKeygen();
  fs.mkdirSync(path.dirname(deviceKeyFile(cenv)), { recursive: true }); writePrivate(deviceKeyFile(cenv), k.privateKeyPem);
  const dev = v.devices.enroll(v.tokens, { kind: 'remote-computer', label: 'base-test', pubkey: k.publicKey, policy: policy() });
  const localToken = v.tokens.issue({ agent: 'cli', scopes: ['read', 'write'], paths: ['**'] }).token;
  const local = async (name, args = {}) => {
    const r = await fetch(`${url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${localToken}`, 'content-type': 'application/json' }, body: JSON.stringify(rpc(name, args)) });
    return unwrap(await r.json().catch(() => null), r.status);
  };
  const remote = async (name, args = {}) => { const res = await remoteFetch({ url, token: dev.token }, 'mcp', { body: rpc(name, args), env: cenv, headers: { 'x-forwarded-for': '198.51.100.40' } }); return unwrap(res.json, res.status); };
  return { v, root, local, remote, close: () => new Promise((r) => server.close(() => { v.close(); r(); })) };
}
export { OWNER };
