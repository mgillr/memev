// SR-0.03 task 1: a contract signed before bases were recorded is never judged on scope or red-green, and a contract signed
// now carries its base under its signature.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, tmpdir, OWNER } from './helpers/tmp.mjs';
import { gitRepo, commit, gitIn, task, signByHand, signedBody, byStatement } from './helpers/contracts-base.mjs';
import { canonicalHash } from '../vendor/attest/signature.mjs';
after(cleanup);

test('a legacy contract without a base is BLOCKED on scope and red-green with nothing run; a contract signed now records HEAD under its signature', () => {
  const { v, root } = newVault({ git: false });
  try {
    // a git workdir whose last commit changes a file outside the task's scope
    const { dir } = gitRepo({ 'src/a.js': 'export const a = 1;\n' });
    commit(dir, { 'outside/evil.js': 'process.exit(0);\n' }, 'out of scope');
    const marker = path.join(tmpdir('base-marker-'), 'red-ran');
    const legacy = signByHand(root, { workdir: dir, tasks: task([
      { statement: 'changes stay in scope', verifier: { type: 'scope' } },
      { statement: 'the test fails before and passes after', verifier: { type: 'test_red_green', test_file: 'src/a.js', cmd: `touch '${marker}'; exit 1` } },
    ]) });
    const r = v.contractVerify(OWNER, { id: legacy.id });
    assert.equal(v.contractCheckSignature(legacy.id).ok, true, 'the hand-signed contract verifies as signed');
    for (const name of ['changes stay in scope', 'the test fails before and passes after']) {
      const cr = byStatement(r)[name];
      assert.equal(cr.status, 'BLOCKED', `${name} was not BLOCKED`);
      assert.match(cr.detail, /no base revision recorded/);
    }
    assert.equal(r.ok, false);
    assert.equal(fs.existsSync(marker), false, 'the red command ran for a contract without a base');

    // a contract signed now: base.sha is the HEAD at signing, and the DSSE payload carries the canonical hash of that body
    const d = v.contractDraft(OWNER, { title: 'Signed now', workdir: dir, tasks: task([{ statement: 'the file exists', verifier: { type: 'file_exists', path: 'src/a.js' } }]) });
    v.contractSign(OWNER, { id: d.id });
    const body = signedBody(root, d.id);
    assert.equal(body.base.sha, gitIn(dir, 'rev-parse', 'HEAD'));
    const env = JSON.parse(fs.readFileSync(path.join(root, 'contracts', 'signed', `${d.id}.sig.json`), 'utf8'));
    assert.equal(Buffer.from(env.payload, 'base64').toString('utf8'), canonicalHash(body));
    assert.equal(v.contractCheckSignature(d.id).ok, true);
    const f = path.join(root, 'contracts', 'signed', `${d.id}.json`);
    fs.writeFileSync(f, `${JSON.stringify({ ...body, base: { ...body.base, sha: 'f'.repeat(40) } }, null, 2)}\n`);
    assert.equal(v.contractCheckSignature(d.id).ok, false, 'an edited base.sha still passed the signature check');
    assert.equal(v.contractVerify(OWNER, { id: d.id }).ok, false);
  } finally { v.close(); }
});
