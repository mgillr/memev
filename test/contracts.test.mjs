import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { newVault, cleanup, OWNER, PKG } from './helpers/tmp.mjs';
after(cleanup);

function setup() {
  const { root, v } = newVault();
  const work = path.join(root, '..', 'work'); fs.mkdirSync(work, { recursive: true });
  const d = v.contractDraft(OWNER, { title: 'Add a health endpoint', project: 'api', workdir: work, tasks: [{ id: 'T1', title: 'health endpoint', scope: ['**'], criteria: [
    { statement: 'the handler exists', verifier: { type: 'file_exists', path: 'health.js' } },
    { statement: 'it answers ok', verifier: { type: 'grep', file: 'health.js', pattern: 'ok: true' } },
    { statement: 'the check script passes', verifier: { type: 'command', cmd: 'test -f health.js' } },
  ] }] });
  return { root, v, work, d };
}

test('self-sign, open until verified, then closed; the signature covers the exact bytes', async () => {
  const { root, v, work, d } = setup();
  const s = v.contractSign(OWNER, { id: d.id, session: 'sess-k' });
  assert.equal(s.signed, true);
  assert.ok(fs.existsSync(path.join(root, 'contracts', 'keys', `${s.keyid}.pub`)));
  assert.equal(v.contractCheckSignature(d.id).ok, true);
  assert.deepEqual(v.contractGate('sess-k').map((c) => c.id), [d.id]);
  assert.deepEqual(v.contractGate('another-session'), []);
  const r1 = await v.contractVerify(OWNER, { id: d.id });
  assert.equal(r1.ok, false);
  fs.writeFileSync(path.join(work, 'health.js'), 'export default () => ({ ok: true });\n');
  const r2 = await v.contractVerify(OWNER, { id: d.id });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal(v.contractList().find((c) => c.id === d.id).state, 'done');
  assert.deepEqual(v.contractGate('sess-k'), []);
  v.close();
});

test('signed contracts are immutable: refused by the vault, rejected by git, and an edit breaks verification', async () => {
  const { root, v, d } = setup();
  v.contractSign(OWNER, { id: d.id });
  v.commits.flush();
  const p = `contracts/signed/${d.id}.json`;
  assert.throws(() => v.write(OWNER, { path: p, body: '{}' }), /immutable/);
  assert.throws(() => v.contractSign(OWNER, { id: d.id }), /already signed/);
  const file = path.join(root, p);
  const c = JSON.parse(fs.readFileSync(file, 'utf8')); c.tasks[0].criteria.pop(); fs.writeFileSync(file, JSON.stringify(c, null, 2));
  assert.match(v.contractCheckSignature(d.id).detail, /changed after signing/);
  assert.equal((await v.contractVerify(OWNER, { id: d.id })).ok, false);
  execFileSync('git', ['add', p], { cwd: root });
  assert.throws(() => execFileSync('git', ['commit', '-q', '-m', 'weaken', '--', p], { cwd: root, stdio: 'pipe' }), /refusing to change signed contract files/);
  execFileSync('git', ['checkout', 'HEAD', '--', p], { cwd: root });
  assert.equal(v.contractCheckSignature(d.id).ok, true);
  const a = v.contractAmend(OWNER, { id: d.id, title: 'Add a health endpoint, smaller' });
  assert.notEqual(a.id, d.id);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, a.path), 'utf8')).supersedes, d.id);
  v.close();
});

test('commands in criteria never run for remote callers', async () => {
  const { v, d } = setup();
  v.contractSign(OWNER, { id: d.id });
  const r = await v.contractVerify(OWNER, { id: d.id }, { local: false });
  assert.equal(r.tasks[0].criteria[2].status, 'BLOCKED');
  v.close();
});

test('decompose turns a scope into a reviewable proposal', () => {
  const { v } = newVault();
  const out = v.contractDecompose(OWNER, { scope: { schema: 'attest-scope/1', prefix: 'API', defaults: { scope: ['src/**'] }, tasks: [{ n: 1, title: 'add route', acceptance: [{ statement: 'tests pass', cmd: 'npm test' }, 'scope'] }, { n: 2, title: 'document it', depends_on: [1], acceptance: [{ statement: 'documented', verifier: { type: 'grep', file: 'src/README.md', pattern: 'health' } }, 'scope'] }] } });
  assert.deepEqual(out.ids, ['API-01', 'API-02']);
  assert.match(out.path, /^contracts\/proposals\//);
  v.close();
});

test('the vendored code keeps its licence and notice, and the licence is compatible', () => {
  const lic = fs.readFileSync(path.join(PKG, 'vendor', 'attest', 'LICENSE'), 'utf8');
  assert.match(lic, /Apache License\s+Version 2\.0/);
  assert.match(fs.readFileSync(path.join(PKG, 'LICENSE'), 'utf8'), /Apache License\s+Version 2\.0/, 'Memev is Apache-2.0 too');
  assert.ok(fs.existsSync(path.join(PKG, 'vendor', 'attest', 'NOTICE')));
  assert.match(fs.readFileSync(path.join(PKG, 'NOTICE'), 'utf8'), /vendor\//);
  for (const f of fs.readdirSync(path.join(PKG, 'vendor', 'attest')).filter((x) => x.endsWith('.mjs'))) assert.match(fs.readFileSync(path.join(PKG, 'vendor', 'attest', f), 'utf8'), /Modified for Memev/, f);
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'));
  assert.ok(pkg.files.includes('vendor/'));
});
