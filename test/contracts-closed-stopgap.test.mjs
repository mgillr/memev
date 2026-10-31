// Issues 242, 243, 247 and 257: what makes a signed contract done or retired is written only by the engine. A token
// cannot write contracts/closed/ or contracts/receipts/ in any letter case, a signature cannot name a key file outside
// contracts/keys/ or vouch for another contract's body, and a superseding contract retires the old one only once it
// was signed on this computer and passed its own verify. The vault runs without git so the test needs no commits.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, OWNER } from './helpers/tmp.mjs';
import { sign as dsseSign } from '../vendor/attest/signature.mjs';
after(cleanup);

// a remote device token as a second computer holds it: write on contracts/**
const REMOTE = { id: 'dev-remote', agent: 'laptop', scopes: ['read', 'write'], paths: ['memory/**', 'work/**', 'contracts/**'], remote: true };

function setup() {
  const { root, v } = newVault({ git: false });
  const work = path.join(root, '..', 'work'); fs.mkdirSync(work, { recursive: true });
  const draft = (title, file, extra = {}) => v.contractDraft(OWNER, { title, project: 'api', workdir: work, tasks: [{ id: 'T1', title, scope: ['**'], criteria: [{ statement: `${file} exists`, verifier: { type: 'file_exists', path: file } }] }], ...extra });
  const a = draft('Real work', 'a.txt');
  v.contractSign(OWNER, { id: a.id, session: 'sess-x' });
  return { root, v, work, a, draft };
}
const state = (v, id) => v.contractList().find((c) => c.id === id)?.state;

test('issues 242 and 243: no token writes closed/, receipts/, signed/ or keys/ in any letter case; verify still closes', () => {
  const { v, work, a } = setup();
  try {
    for (const who of [REMOTE, OWNER]) {
      for (const p of [`contracts/closed/${a.id}.json`, `contracts/Closed/${a.id}.json`, `contracts/CLOSED/${a.id}.json`, `contracts/Signed/${a.id}.json`, `contracts/Keys/0123456789abcdef.pub`]) {
        assert.throws(() => v.write(who, { path: p, body: '{"id":"x","ok":true}\n' }), (e) => e.code === 'immutable', `${who.agent} wrote ${p}`);
      }
      assert.throws(() => v.append(who, { path: `contracts/Receipts/${a.id}.md`, text: 'forged PASS\n' }), (e) => e.code === 'immutable');
      assert.throws(() => v.append(who, { path: `contracts/receipts/${a.id}.md`, text: 'forged PASS\n' }), (e) => e.code === 'immutable');
    }
    assert.equal(state(v, a.id), 'open');
    assert.deepEqual(v.contractGate('sess-x').map((c) => c.id), [a.id]);
    // the engine's own verify still writes the receipt and the close
    fs.writeFileSync(path.join(work, 'a.txt'), 'done\n');
    assert.equal(v.contractVerify(OWNER, { id: a.id }).ok, true);
    assert.equal(state(v, a.id), 'done');
    assert.deepEqual(v.contractGate('sess-x'), []);
  } finally { v.close(); }
});

test('issue 247 and a swapped body: a signature naming a key outside contracts/keys/, or vouching for another contract, is refused', () => {
  const { root, v, a, draft } = setup();
  try {
    assert.equal(v.contractCheckSignature(a.id).ok, true);
    // an attacker key placed where any contracts/** token can write, and the contract body rewritten and signed with it
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    v.write(REMOTE, { path: 'contracts/drafts/k.pub', body: publicKey.export({ type: 'spki', format: 'pem' }) });
    const bodyFile = path.join(root, 'contracts', 'signed', `${a.id}.json`); const sigFile = path.join(root, 'contracts', 'signed', `${a.id}.sig.json`);
    const forged = JSON.parse(fs.readFileSync(bodyFile, 'utf8')); forged.tasks[0].criteria = [{ statement: 'nothing', verifier: { type: 'file_exists', path: '.' } }];
    const env = dsseSign(forged, privateKey.export({ type: 'pkcs8', format: 'pem' })); env.signatures[0].keyid = '../drafts/k';
    const keepBody = fs.readFileSync(bodyFile); const keepSig = fs.readFileSync(sigFile);
    fs.writeFileSync(bodyFile, `${JSON.stringify(forged, null, 2)}\n`); fs.writeFileSync(sigFile, JSON.stringify(env));
    const r = v.contractCheckSignature(a.id);
    assert.equal(r.ok, false, 'a key id that names contracts/drafts/k.pub was trusted');
    assert.match(r.detail, /key id/);
    // a second contract's genuine signed files copied over the first one's
    fs.writeFileSync(bodyFile, keepBody); fs.writeFileSync(sigFile, keepSig);
    const b = draft('Other work', 'b.txt'); v.contractSign(OWNER, { id: b.id });
    fs.copyFileSync(path.join(root, 'contracts', 'signed', `${b.id}.json`), bodyFile);
    fs.copyFileSync(path.join(root, 'contracts', 'signed', `${b.id}.sig.json`), sigFile);
    const s = v.contractCheckSignature(a.id);
    assert.equal(s.ok, false, 'another contract\'s signed body was accepted as this one');
    assert.match(s.detail, /signed body is contract/);
  } finally { v.close(); }
});

test('issue 257: a superseding contract retires the old one only once signed here and passed; an empty one is not signed', () => {
  const { root, v, work, a, draft } = setup();
  try {
    // a remote token writes an empty draft that supersedes A and signs it
    const tmpl = draft('Template', 't.txt', { supersedes: a.id });
    const empty = { ...JSON.parse(fs.readFileSync(path.join(root, tmpl.path), 'utf8')), id: 'x-forged', tasks: [] };
    v.write(REMOTE, { path: 'contracts/drafts/x-forged.json', body: `${JSON.stringify(empty, null, 2)}\n` });
    assert.throws(() => v.contractSign(REMOTE, { id: 'x-forged', local: false }), /at least one task/);
    // with one trivial task, signed by the remote token and even passed: A stays open and in the gate
    // (its workdir is inside the vault, under work/, where a remote-signed contract's file criteria can pass)
    const inside = path.join(root, 'work'); fs.mkdirSync(inside, { recursive: true });
    const trivial = { ...empty, id: 'x-trivial', workdir: inside, tasks: JSON.parse(fs.readFileSync(path.join(root, tmpl.path), 'utf8')).tasks };
    v.write(REMOTE, { path: 'contracts/drafts/x-trivial.json', body: `${JSON.stringify(trivial, null, 2)}\n` });
    v.contractSign(REMOTE, { id: 'x-trivial', local: false });
    v.write(REMOTE, { path: 'work/t.txt', body: 'x\n' });
    assert.equal(v.contractVerify(OWNER, { id: 'x-trivial' }).ok, true);
    assert.equal(state(v, a.id), 'open', 'a remotely signed contract retired A');
    assert.deepEqual(v.contractGate('sess-x').map((c) => c.id), [a.id]);
    // a version signed on this computer retires A, but only after its own verify passes
    const b = draft('Real work, v2', 'b2.txt', { supersedes: a.id });
    v.contractSign(OWNER, { id: b.id });
    assert.equal(state(v, a.id), 'open', 'a signed but unverified version retired A');
    fs.writeFileSync(path.join(work, 'b2.txt'), 'x\n');
    assert.equal(v.contractVerify(OWNER, { id: b.id }).ok, true);
    assert.equal(state(v, a.id), 'superseded');
    assert.deepEqual(v.contractGate('sess-x'), []);
  } finally { v.close(); }
});
