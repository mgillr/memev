// SPDX-License-Identifier: Apache-2.0
// A locally signed contract that records no base gets one from git history: the parent of the commit that first added its body.
// Nobody chooses it and nothing new is signed, and the receipt says it was derived.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, tmpdir, OWNER, PKG } from './helpers/tmp.mjs';
import { gitRepo, commit, gitIn, task, signByHand, signedBody, byStatement } from './helpers/contracts-base.mjs';
after(cleanup);

const SCOPE = { statement: 'changes stay in scope', verifier: { type: 'scope' } };
const bodyPath = (id) => `contracts/signed/${id}.json`;
const scopeOf = async (v, id) => byStatement(await v.contractVerify(OWNER, { id }))['changes stay in scope'];

/** A vault with a legacy contract, and its body committed in a checkout (`dir`) after the first commit (`head`). */
function committed({ tasks = task([SCOPE]) } = {}) {
  const { v, root } = newVault({ git: false });
  const { dir, head } = gitRepo();
  const { id } = signByHand(root, { workdir: dir, tasks });
  const text = fs.readFileSync(path.join(root, bodyPath(id)), 'utf8');
  commit(dir, { [bodyPath(id)]: text });
  commit(dir, { 'later.txt': 'later\n' });
  v.config.contracts = { ...(v.config.contracts || {}), redteam_root: dir };
  return { v, root, dir, head, id, text };
}

test('T2a: the base is derived as the parent of the commit that first added the body, and the receipt says so', async () => {
  const { v, root, id, head } = committed();
  try {
    const before = fs.readFileSync(path.join(root, bodyPath(id)));
    const r = await scopeOf(v, id);
    assert.notEqual(r.status, 'BLOCKED', r.detail);
    const out = await v.contractVerify(OWNER, { id });
    assert.equal(out.base, head); assert.equal(out.base_source, 'derived');
    assert.match(fs.readFileSync(path.join(root, 'contracts', 'receipts', `${id}.md`), 'utf8'), new RegExp(`base derived: ${head}`));
    assert.deepEqual(fs.readFileSync(path.join(root, bodyPath(id))), before, 'the body is not changed');
    assert.equal(v.contractCheckSignature(id).ok, true);
    assert.equal(signedBody(root, id).base, undefined);
  } finally { v.close(); }
});

test('T2a: a later change to the body does not move the base', async () => {
  const { v, dir, id, head, text } = committed();
  try {
    commit(dir, { [bodyPath(id)]: `${text}\n` }); // same contract, new bytes
    assert.equal((await v.contractVerify(OWNER, { id })).base, head);
  } finally { v.close(); }
});

test('T2a: deleting the body and adding it again does not move the base', async () => {
  const { v, dir, id, head, text } = committed();
  try {
    gitIn(dir, 'rm', '-q', bodyPath(id));
    gitIn(dir, 'commit', '-q', '-m', 'remove');
    commit(dir, { [bodyPath(id)]: text });
    assert.equal((await v.contractVerify(OWNER, { id })).base, head);
  } finally { v.close(); }
});

test('T2a: with no checkout that holds the body the result is BLOCKED with that reason, and no record of anything else', async () => {
  const { v, root } = newVault({ git: false });
  try {
    const { dir } = gitRepo();
    const { id } = signByHand(root, { workdir: dir, tasks: task([SCOPE]) });
    const r = await scopeOf(v, id);
    assert.equal(r.status, 'BLOCKED'); assert.match(r.detail, /no base revision recorded/); assert.match(r.detail, /no checkout|does not hold/);
  } finally { v.close(); }
});

test('T2a: a checkout holding a different contract under that name gives BLOCKED', async () => {
  const { v, dir, id } = committed();
  try {
    commit(dir, { [bodyPath(id)]: `${JSON.stringify({ id, title: 'another' })}\n` });
    const r = await scopeOf(v, id);
    assert.equal(r.status, 'BLOCKED'); assert.match(r.detail, /different contract/);
  } finally { v.close(); }
});

test('T2a: a shallow clone is refused', async () => {
  const { v, dir, id } = committed();
  try {
    const shallow = path.join(fs.realpathSync(tmpdir('base-shallow-')), 'c');
    gitIn(dir, 'clone', '-q', '--depth', '1', `file://${dir}`, shallow);
    v.config.contracts.redteam_root = shallow;
    const r = await scopeOf(v, id);
    assert.equal(r.status, 'BLOCKED'); assert.match(r.detail, /shallow/);
  } finally { v.close(); }
});

test('T2a: a body that was moved still resolves to its first add', async () => {
  const { dir, head } = gitRepo();
  commit(dir, { 'contracts/old/k-m.json': '{"id":"k-m","tasks":[],"title":"a long enough body so that git sees a rename and not a new file"}\n' });
  fs.mkdirSync(path.join(dir, 'contracts', 'signed'), { recursive: true });
  gitIn(dir, 'mv', 'contracts/old/k-m.json', bodyPath('k-m'));
  gitIn(dir, 'commit', '-q', '-m', 'move');
  // first an assertion, so that before the module exists this fails on an assertion and not on a load error
  assert.ok(fs.existsSync(path.join(PKG, 'src', 'engine', 'contract-base.mjs')), 'the module that derives the base exists');
  const { deriveBase } = await import('../src/engine/contract-base.mjs');
  const contract = JSON.parse(fs.readFileSync(path.join(dir, bodyPath('k-m')), 'utf8'));
  assert.deepEqual(deriveBase({ repo: dir, id: 'k-m', contract }), { sha: head });
});

test('T2a: a body with its own base never uses the derived one', async () => {
  const { v, root } = newVault({ git: false });
  try {
    const { dir, head } = gitRepo();
    const next = commit(dir, { 'second.txt': 'x\n' });
    const { id } = signByHand(root, { workdir: dir, tasks: task([SCOPE]), fields: { base: { sha: next, recorded_at: new Date().toISOString() } } });
    commit(dir, { [bodyPath(id)]: fs.readFileSync(path.join(root, bodyPath(id)), 'utf8') });
    v.config.contracts = { ...(v.config.contracts || {}), redteam_root: dir };
    const out = await v.contractVerify(OWNER, { id });
    assert.equal(out.base, next); assert.notEqual(out.base, head); assert.notEqual(out.base_source, 'derived');
  } finally { v.close(); }
});

test('T2a: a remote-signed contract never uses a derived base', async () => {
  const { v, root } = newVault({ git: false });
  try {
    const { dir } = gitRepo();
    // first the same fixture signed locally does derive, so this cannot pass on a verifier that never derives
    const local = signByHand(root, { workdir: dir, tasks: task([SCOPE]) });
    commit(dir, { [bodyPath(local.id)]: fs.readFileSync(path.join(root, bodyPath(local.id)), 'utf8') });
    v.config.contracts = { ...(v.config.contracts || {}), redteam_root: dir };
    assert.equal((await v.contractVerify(OWNER, { id: local.id })).base_source, 'derived');
    const { id } = signByHand(root, { workdir: dir, tasks: task([SCOPE]), fields: { origin: 'remote' } });
    commit(dir, { [bodyPath(id)]: fs.readFileSync(path.join(root, bodyPath(id)), 'utf8') });
    assert.notEqual((await v.contractVerify(OWNER, { id })).base_source, 'derived');
  } finally { v.close(); }
});

test('T2a: work in another repository from the body has no derived base it can use, and says so', async () => {
  const { v, root } = newVault({ git: false });
  try {
    const home = gitRepo().dir; const work = gitRepo({ 'other.md': 'x\n' }).dir;
    const { id } = signByHand(root, { workdir: work, tasks: task([SCOPE]) });
    commit(home, { [bodyPath(id)]: fs.readFileSync(path.join(root, bodyPath(id)), 'utf8') });
    v.config.contracts = { ...(v.config.contracts || {}), redteam_root: home };
    const r = await scopeOf(v, id);
    assert.equal(r.status, 'BLOCKED'); assert.match(r.detail, /not found/);
  } finally { v.close(); }
});

test('T2a: a derived base does not judge scope, and an own base still does', async () => {
  const FILE = { statement: 'the file exists', verifier: { type: 'file_exists', path: 'README.md' } };
  const { v, root, dir, id, head } = committed({ tasks: task([SCOPE, FILE]) });
  try {
    commit(dir, { 'docs/someone-elses-later-work.md': 'y\n' });
    const out = await v.contractVerify(OWNER, { id });
    const r = byStatement(out)['changes stay in scope'];
    assert.equal(r.status, 'NOT JUDGED', r.detail);
    assert.match(r.detail, /derived base/);
    assert.equal(out.verdict, 'PASS', 'the other criteria decide the verdict');
    assert.equal(out.scope_not_judged, true);
    assert.match(fs.readFileSync(path.join(root, 'contracts', 'receipts', `${id}.md`), 'utf8'), /scope not judged/);
    // the same later commit still fails a body that recorded its own base
    const own = signByHand(root, { workdir: dir, tasks: task([SCOPE]), fields: { base: { sha: head, recorded_at: new Date().toISOString() } } });
    const o = byStatement(await v.contractVerify(OWNER, { id: own.id }))['changes stay in scope'];
    assert.equal(o.status, 'FAIL', o.detail);
  } finally { v.close(); }
});

test('the docs state the exception to the signature covering the base', () => {
  assert.match(fs.readFileSync(path.join(PKG, 'docs', 'CONTRACTS.md'), 'utf8'), /base derived/i);
});
