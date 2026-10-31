// SR-0.03 task 1: the base revision a contract's work starts from is recorded when it is signed, inside what the signature
// covers, and a scope criterion without one is never PASS.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, tmpdir, OWNER } from './helpers/tmp.mjs';
import { gitRepo, commit, gitIn, task, signByHand, signedBody, byStatement } from './helpers/contracts-base.mjs';
after(cleanup);

const SCOPE = { statement: 'changes stay in scope', verifier: { type: 'scope' } };
const FILE = { statement: 'the file exists', verifier: { type: 'file_exists', path: 'README.md' } };

test('signing in a git workdir records the base sha, the HEAD at signing, inside the signed body', () => {
  const { v } = newVault({ git: false });
  try {
    const { dir, head } = gitRepo();
    const d = v.contractDraft(OWNER, { title: 'Base at signing', workdir: dir, tasks: task([FILE]) });
    const s = v.contractSign(OWNER, { id: d.id });
    const body = signedBody(v.root, d.id);
    assert.equal(body.base.sha, head);
    assert.equal(s.base, head);
    assert.ok(!Number.isNaN(Date.parse(body.base.recorded_at)), 'recorded_at is a time');
    assert.equal(v.contractCheckSignature(d.id).ok, true);
  } finally { v.close(); }
});

test('a signed contract without a recorded base gets BLOCKED on its scope criterion, never PASS', async () => {
  const { v, root } = newVault({ git: false });
  try {
    const { dir } = gitRepo();
    const legacy = signByHand(root, { workdir: dir, tasks: task([SCOPE]) });
    const r1 = await v.contractVerify(OWNER, { id: legacy.id });
    assert.equal(byStatement(r1)['changes stay in scope'].status, 'BLOCKED');
    assert.match(byStatement(r1)['changes stay in scope'].detail, /no base revision recorded/);
    // a workdir that is not a git checkout gives no base to record
    const plain = tmpdir('base-plain-');
    const d = v.contractDraft(OWNER, { title: 'No git here', workdir: plain, tasks: task([SCOPE]) });
    v.contractSign(OWNER, { id: d.id });
    assert.equal(signedBody(root, d.id).base, undefined);
    const r2 = await v.contractVerify(OWNER, { id: d.id });
    assert.equal(byStatement(r2)['changes stay in scope'].status, 'BLOCKED');
    assert.match(byStatement(r2)['changes stay in scope'].detail, /no base revision recorded/);
    assert.equal(r2.ok, false);
  } finally { v.close(); }
});

test('T1-c08: In a temporary git repository at commit H, a contract whose spec names the explicit base M, an earlier commit, records base.sha M when it is signed at H, and a contract whose spec names no base records H; in both cases the DSSE signature covers the recorded base.', () => {
  const { v, root } = newVault({ git: false });
  try {
    const { dir, head: M } = gitRepo();
    const H = commit(dir, { 'src/a.js': 'export const a = 1;\n' });
    assert.notEqual(M, H);
    const named = v.contractDraft(OWNER, { title: 'Named base', workdir: dir, base: M, tasks: task([FILE]) });
    const plain = v.contractDraft(OWNER, { title: 'HEAD base', workdir: dir, tasks: task([FILE]) });
    v.contractSign(OWNER, { id: named.id });
    v.contractSign(OWNER, { id: plain.id });
    assert.equal(signedBody(root, named.id).base?.sha, M);
    assert.equal(signedBody(root, plain.id).base?.sha, H);
    for (const [id, other] of [[named.id, H], [plain.id, M]]) {
      assert.equal(v.contractCheckSignature(id).ok, true);
      const f = path.join(root, 'contracts', 'signed', `${id}.json`);
      const keep = fs.readFileSync(f, 'utf8');
      const edited = JSON.parse(keep); edited.base.sha = other;
      fs.writeFileSync(f, `${JSON.stringify(edited, null, 2)}\n`);
      assert.equal(v.contractCheckSignature(id).ok, false, 'the signature does not cover the base');
      fs.writeFileSync(f, keep);
    }
  } finally { v.close(); }
});

test('memev contract new: a null workdir is refused unless --workdir is given, the workdir is recorded as its real path, and the base is a 40-hex sha', async () => {
  const { newContractSpec } = await import('../src/cli/contracts-cli.mjs');
  assert.equal(typeof newContractSpec, 'function', 'memev contract new has no spec check');
  const spec = { title: 'From a spec', workdir: null, tasks: task([FILE]) };
  assert.throws(() => newContractSpec(spec, {}), /names no workdir/);
  const { dir, head } = gitRepo();
  const link = path.join(tmpdir('base-link-'), 'wd');
  fs.symlinkSync(dir, link);
  const s = newContractSpec(spec, { workdir: link, base: head });
  assert.equal(s.workdir, fs.realpathSync(dir));
  assert.ok(path.isAbsolute(s.workdir));
  assert.equal(s.base, head);
  assert.equal(newContractSpec({ ...spec, workdir: dir }, {}).workdir, fs.realpathSync(dir));
  for (const bad of ['HEAD', 'abc', '--output=x', `${head}0`]) assert.throws(() => newContractSpec({ ...spec, workdir: dir, base: bad }, {}), /40 hex/);
  assert.throws(() => newContractSpec(spec, { workdir: path.join(dir, 'missing') }), /does not exist/);
  assert.equal(gitIn(dir, 'rev-parse', 'HEAD'), head);
});
