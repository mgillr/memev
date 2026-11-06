// SPDX-License-Identifier: Apache-2.0
// A contract signed with no base can get one without being signed again: a signed record beside the body names the
// contract's hash and its base. The base is never chosen by hand: it is the parent of the commit that first added the body.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { newVault, cleanup, tmpdir, OWNER, PKG } from './helpers/tmp.mjs';
import { gitRepo, commit, gitIn, task, signByHand, signedBody, byStatement } from './helpers/contracts-base.mjs';
import { signBaseRecord, mechanicalBase } from '../scripts/contracts/base-record.mjs';
after(cleanup);

const SCOPE = { statement: 'changes stay in scope', verifier: { type: 'scope' } };
const noBase = /no base revision recorded/;
const recordFile = (root, id) => path.join(root, 'contracts', 'signed', `${id}.base.txt`);
const write = (root, id, rec) => fs.writeFileSync(recordFile(root, id), `${JSON.stringify(rec, null, 2)}\n`);

function legacy() {
  const { v, root } = newVault({ git: false });
  const { dir, head } = gitRepo();
  const c = signByHand(root, { workdir: dir, tasks: task([SCOPE]) });
  return { v, root, dir, head, id: c.id, key: c.privateKeyPem };
}
const scopeOf = async (v, id) => byStatement(await v.contractVerify(OWNER, { id }))['changes stay in scope'];

test('T2a: a body with no base and no record stays BLOCKED', async () => {
  const { v, id } = legacy();
  try { const r = await scopeOf(v, id); assert.equal(r.status, 'BLOCKED'); assert.match(r.detail, noBase); } finally { v.close(); }
});

test('T2a: a valid record gives the contract a base, and the body and its signature do not change', async () => {
  const { v, root, id, head, key } = legacy();
  try {
    const before = fs.readFileSync(path.join(root, 'contracts', 'signed', `${id}.json`));
    write(root, id, signBaseRecord({ contract: signedBody(root, id), sha: head, privateKeyPem: key, by: 'test' }));
    const r = await scopeOf(v, id);
    assert.notEqual(r.status, 'BLOCKED', r.detail);
    assert.equal(v.contractCheckSignature(id).ok, true);
    assert.deepEqual(fs.readFileSync(path.join(root, 'contracts', 'signed', `${id}.json`)), before);
  } finally { v.close(); }
});

test('T2a: a changed record gives BLOCKED', async () => {
  const { v, root, id, head, key, dir } = legacy();
  try {
    const rec = signBaseRecord({ contract: signedBody(root, id), sha: head, privateKeyPem: key, by: 'test' });
    rec.base.sha = commit(dir, { 'later.txt': 'later\n' });
    write(root, id, rec);
    const out = await v.contractVerify(OWNER, { id });
    assert.equal(out.ok, false); assert.equal(out.verdict, 'BLOCKED'); assert.match(out.detail, /base record/);
  } finally { v.close(); }
});

test('T2a: a record for another contract hash gives BLOCKED', async () => {
  const { v, root, id, head, key } = legacy();
  try {
    write(root, id, signBaseRecord({ contract: { ...signedBody(root, id), title: 'another contract' }, sha: head, privateKeyPem: key, by: 'test' }));
    const out = await v.contractVerify(OWNER, { id });
    assert.equal(out.verdict, 'BLOCKED'); assert.match(out.detail, /base record/);
  } finally { v.close(); }
});

test('T2a: a record signed by a key other than the contract\'s gives BLOCKED, even if that key is in the keys folder', async () => {
  const { v, root, id, head } = legacy();
  const other = legacy();
  try {
    const rec = signBaseRecord({ contract: signedBody(root, id), sha: head, privateKeyPem: other.key, by: 'test' });
    const kid = rec.sig.signatures[0].keyid;
    fs.copyFileSync(path.join(other.root, 'contracts', 'keys', `${kid}.pub`), path.join(root, 'contracts', 'keys', `${kid}.pub`));
    write(root, id, rec);
    const out = await v.contractVerify(OWNER, { id });
    assert.equal(out.verdict, 'BLOCKED'); assert.match(out.detail, /base record/);
  } finally { v.close(); other.v.close(); }
});

test('T2a: a body with its own base ignores a record, even a broken one', async () => {
  const { v, root } = newVault({ git: false });
  try {
    const { dir } = gitRepo();
    const d = v.contractDraft(OWNER, { title: 'Own base', workdir: dir, tasks: task([SCOPE]) });
    v.contractSign(OWNER, { id: d.id });
    assert.ok(signedBody(root, d.id).base?.sha);
    fs.writeFileSync(recordFile(root, d.id), 'not json');
    const r = await scopeOf(v, d.id);
    assert.notEqual(r.status, 'BLOCKED', r.detail);
  } finally { v.close(); }
});

test('T2b: the base is the parent of the commit that first added the signed body, not any later one', () => {
  const { dir, head } = gitRepo();
  commit(dir, { 'contracts/signed/k-x.json': '{"id":"k-x"}\n' });
  commit(dir, { 'contracts/signed/k-x.json': '{"id":"k-x","changed":true}\n' });
  commit(dir, { 'other.txt': 'x\n' });
  assert.equal(mechanicalBase({ repo: dir, id: 'k-x' }), head);
});

test('T2b: a body never committed, or added in the first commit of a history, has no base and says so', () => {
  const { dir } = gitRepo();
  assert.throws(() => mechanicalBase({ repo: dir, id: 'k-none' }), /never committed/);
  const fresh = fs.realpathSync(tmpdir('base-fresh-'));
  gitIn(fresh, 'init', '-q');
  commit(fresh, { 'contracts/signed/k-root.json': '{}\n' });
  assert.throws(() => mechanicalBase({ repo: fresh, id: 'k-root' }), /no parent/);
});

test('T2b: the command writes no record unless a key is given, and prints what it would sign', () => {
  const { dir, head } = gitRepo();
  commit(dir, { 'contracts/signed/k-y.json': '{"id":"k-y","tasks":[]}\n' });
  const r = spawnSync(process.execPath, [path.join(PKG, 'scripts', 'contracts', 'base-record.mjs'), '--repo', dir, '--id', 'k-y'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).base, head);
  assert.equal(fs.existsSync(path.join(dir, 'contracts', 'signed', 'k-y.base.txt')), false);
});
