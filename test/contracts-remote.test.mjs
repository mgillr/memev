import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, OWNER } from './helpers/tmp.mjs';
after(cleanup);

function setup() {
  const { root, v } = newVault();
  const work = path.join(root, 'work'); fs.mkdirSync(work, { recursive: true });
  const d = v.contractDraft(OWNER, { title: 'Remote contract test', project: 'api', workdir: work, tasks: [{ id: 'T1', title: 'health endpoint', scope: ['**'], criteria: [
    { statement: 'the handler exists', verifier: { type: 'file_exists', path: 'health.js' } },
    { statement: 'the check script passes', verifier: { type: 'command', cmd: 'test -f health.js' } },
  ] }] });
  return { root, v, work, d };
}

test('REV-002 AC01: a remote-signed contract records origin remote and blocks commands until approved', () => {
  const { v, d, work } = setup();
  const s = v.contractSign(OWNER, { id: d.id, local: false });
  assert.equal(s.origin, 'remote');
  const r1 = v.contractVerify(OWNER, { id: d.id }, { local: true });
  assert.equal(r1.tasks[0].criteria[1].status, 'BLOCKED');
  assert.match(r1.tasks[0].criteria[1].detail, /approve/);
  fs.writeFileSync(path.join(work, 'health.js'), 'ok\n');
  const r2 = v.contractVerify(OWNER, { id: d.id }, { local: true });
  assert.equal(r2.tasks[0].criteria[1].status, 'BLOCKED');
  v.contractApprove(OWNER, { id: d.id });
  const r3 = v.contractVerify(OWNER, { id: d.id }, { local: true });
  assert.equal(r3.tasks[0].criteria[1].status, 'PASS');
  assert.equal(r3.ok, true);
  v.close();
});

test('REV-002 AC02: the resume card does not solicit verify for an unapproved remote contract', () => {
  const { v, d } = setup();
  v.contractSign(OWNER, { id: d.id, local: false, session: 'sess-remote' });
  const card = v.sessionStart(OWNER, { task: 'test', project: 'api', session: 'sess-remote' });
  const text = JSON.stringify(card.open_contracts || []);
  assert.ok(text.includes(d.id));
  const oc = card.open_contracts.find((k) => k.id === d.id);
  assert.equal(oc.origin, 'remote');
  assert.equal(oc.approved, false);
  v.close();
});

test('REV-002 AC03: file_exists and grep paths are confined to the vault root', () => {
  const { v, d, work } = setup();
  v.contractSign(OWNER, { id: d.id, local: true });
  const r = v.contractVerify(OWNER, { id: d.id }, { local: true });
  assert.equal(r.tasks[0].criteria[0].status, 'FAIL');
  const d2 = v.contractDraft(OWNER, { title: 'Escape test', project: 'api', workdir: work, tasks: [{ id: 'T1', title: 'escape', scope: ['**'], criteria: [
    { statement: 'escape vault', verifier: { type: 'file_exists', path: '../../etc/passwd' } },
    { statement: 'absolute path', verifier: { type: 'grep', file: '/etc/passwd', pattern: 'root' } },
  ] }] });
  v.contractSign(OWNER, { id: d2.id, local: true });
  const r2 = v.contractVerify(OWNER, { id: d2.id }, { local: true });
  assert.equal(r2.tasks[0].criteria[0].status, 'BLOCKED');
  assert.match(r2.tasks[0].criteria[0].detail, /escapes/);
  assert.equal(r2.tasks[0].criteria[1].status, 'BLOCKED');
  assert.match(r2.tasks[0].criteria[1].detail, /absolute/);
  v.close();
});

test('REV-002 AC04: no caller-supplied string is interpolated into a shell command', () => {
  const { v, d, work } = setup();
  v.contractSign(OWNER, { id: d.id, local: true });
  const marker = path.join(work, 'pwned');
  const d2 = v.contractDraft(OWNER, { title: 'Injection test', project: 'api', workdir: work, tasks: [{ id: 'T1', title: 'inject', scope: ['**'], criteria: [
    { statement: 'injection', verifier: { type: 'command', cmd: `touch ${marker}` } },
  ] }] });
  v.contractSign(OWNER, { id: d2.id, local: true });
  const r = v.contractVerify(OWNER, { id: d2.id }, { local: true });
  assert.equal(r.tasks[0].criteria[0].status, 'PASS');
  assert.ok(fs.existsSync(marker));
  v.close();
});
