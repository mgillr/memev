// SPDX-License-Identifier: Apache-2.0
// SO-F-03: a contribution is an operation envelope (PG-04.1) with a signature and admission block. The node admits it in
// two steps before it appends anything: the signature is checked, then authority and policy for the scope and the
// classification. A failure at either step, and a replay, record a rejected event in the vault's own operation log and
// append nothing of the payload. Test names start with the id the contract's checks select on.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir, cleanup, newVault, PKG } from './helpers/tmp.mjs';
import { Vault } from '../src/engine/vault.mjs';
import { OpLog } from '../src/engine/oplog.mjs';
import { deviceKeygen } from '../src/engine/devices.mjs';
import { buildEnvelope, validateEnvelope, canonicalize, ENVELOPE_FIELDS } from '../src/engine/envelope.mjs';
import { NAMESPACE, setupAgentRole, bindingMessage, signNamespaced, verifyNamespaced, roleKeyToOpenSsh, CONTRIBUTION_NAMESPACE, AgentBindError } from '../src/engine/agentid-bind.mjs';
import { CONTRIBUTION_SCHEMA, CONTRIBUTION_FIELDS, signContribution, validateContribution, contributionMessage } from '../src/engine/federation/contribution.mjs';
import { Admission } from '../src/engine/federation/admission.mjs';

after(cleanup);

const SCOPE_A = { type: 'team', id: 'team-a' };
const SCOPE_B = { type: 'team', id: 'team-b' };
const MERGE = { strategy: 'last-writer', mapping_version: 'map-1', policy: { retain: '30d' } };
const SECRET = 'PAYLOAD-MARKER-7c1d9e';
const SINCE = '2026-01-01T00:00:00Z';
const POLICY = { accept: [{ scope: SCOPE_A, classifications: ['internal', 'public'] }, { scope: SCOPE_B, classifications: ['internal'] }] };

function makeRole(dir, role) {
  fs.mkdirSync(dir, { recursive: true });
  const { privateKeyPem, publicKey } = deviceKeygen();
  const keyPath = path.join(dir, role);
  fs.writeFileSync(keyPath, privateKeyPem, { mode: 0o600 });
  fs.writeFileSync(`${keyPath}.pub`, `${publicKey}\n`, { mode: 0o644 });
  return { role, keyPath, publicKey };
}
const subjectOf = (r, extra = {}) => ({ id: `agent:${r.role}`, type: 'agent', owner: 'person:owner', role: r.role, keys: [{ id: r.role, alg: 'ed25519', public: r.publicKey }], ...extra });
function identityDoc(roles, { memberships, subjectExtra = {} } = {}) {
  return {
    schema: 'memev-identity/1',
    subjects: [{ id: 'person:owner', type: 'person', owner: 'person:owner' }, ...roles.map((r) => subjectOf(r, subjectExtra[r.role]))],
    scopes: [{ id: SCOPE_A.id, type: SCOPE_A.type }, { id: SCOPE_B.id, type: SCOPE_B.type }],
    memberships: memberships ?? roles.map((r) => ({ subject: `agent:${r.role}`, scope: SCOPE_A.id, since: SINCE })),
  };
}
const signer = (r, namespace = CONTRIBUTION_NAMESPACE) => (message) => signNamespaced(message, { keyPath: r.keyPath, principal: r.role, namespace });
function contribute(r, { seq = 1, node = 'node-01', scope = SCOPE_A, classification = 'internal', payload = { note: SECRET, n: seq }, sign = signer(r), op_id, derived_from = [] } = {}) {
  return signContribution({
    origin: { identity: `agent:${r.role}`, node },
    op_id: op_id ?? `op-${node}-${seq}`,
    hlc: `${String(1761990000000 + seq)}.0000`,
    type: 'note.write',
    project: 'proj-1',
    payload,
    merge_contract: MERGE,
    contribution: { subject: `agent:${r.role}`, scope, classification, sequence: seq, provenance: { source: 'sandbox-test', derived_from } },
  }, { sign, principal: r.role });
}
// change a signed envelope and keep it a well-formed one: the content hash is rebuilt, the signature is not
function retouch(env, mutate) {
  const { schema, content_hash, ...fields } = structuredClone(env); void schema; void content_hash;
  mutate(fields);
  return buildEnvelope(fields);
}
function world({ roles = ['writer'], doc, scope = SCOPE_A, policy = POLICY, external = null } = {}) {
  const dir = tmpdir('memev-fed-');
  const made = roles.map((r) => makeRole(path.join(dir, 'agents'), r));
  const log = new OpLog(path.join(dir, 'oplog'), { fsync: false, deviceId: 'dev-test' }).open();
  const identity = doc ? doc(made) : identityDoc(made);
  const adm = new Admission({ log, identity, scope, policy, external });
  return { dir, made, role: made[0], log, identity, adm };
}
const records = (log) => [...log.iterate()];
const kinds = (log) => records(log).map((r) => r.type);
const logText = (log) => records(log).map((r) => JSON.stringify(r)).join('\n');

// ---- AC02: the schema, the block, the validator, the signature path

test('SO-F-03 AC02: the schema defines only the signature and admission block, and not a second envelope', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(PKG, 'docs/schemas/contribution-v1.json'), 'utf8'));
  assert.equal(schema.schema, CONTRIBUTION_SCHEMA);
  assert.equal(CONTRIBUTION_SCHEMA, 'memev-contribution/1');
  assert.equal(schema.extends, 'memev-envelope/1', 'it names the one envelope it extends');
  assert.deepEqual(Object.keys(schema.properties).sort(), [...CONTRIBUTION_FIELDS].sort());
  assert.deepEqual([...schema.required].sort(), [...CONTRIBUTION_FIELDS].sort());
  for (const f of ENVELOPE_FIELDS) if (f !== 'schema') assert.ok(!(f in schema.properties), `the block does not define the envelope field ${f}`);
  assert.deepEqual(Object.keys(schema.properties.signature.properties).sort(), ['namespace', 'principal', 'sshsig']);
  assert.equal(schema.properties.signature.properties.namespace.const, CONTRIBUTION_NAMESPACE);
  assert.notEqual(CONTRIBUTION_NAMESPACE, NAMESPACE, 'a namespace of its own, apart from the role binding namespace');
  assert.equal(schema.additionalProperties, false);
});

test('SO-F-03 AC02: a contribution is an operation envelope, and the validator accepts a signed fixture', () => {
  const { role } = world();
  const c = contribute(role, { seq: 3, derived_from: ['op-a', 'op-b'] });
  assert.deepEqual(validateEnvelope(c), { ok: true, errors: [] });
  assert.deepEqual(validateContribution(c), { ok: true, errors: [] });
  const b = c.extension.contribution;
  assert.deepEqual(Object.keys(b).sort(), [...CONTRIBUTION_FIELDS].sort());
  assert.equal(b.schema, CONTRIBUTION_SCHEMA);
  assert.equal(b.subject, 'agent:writer');
  assert.deepEqual(b.scope, SCOPE_A);
  assert.equal(b.classification, 'internal');
  assert.equal(b.sequence, 3);
  assert.equal(b.payload_hash, crypto.createHash('sha256').update(canonicalize(c.payload)).digest('hex'));
  assert.deepEqual(b.provenance, { source: 'sandbox-test', derived_from: ['op-a', 'op-b'] });
  assert.equal(b.signature.namespace, CONTRIBUTION_NAMESPACE);
  assert.equal(b.signature.principal, 'writer');
  assert.match(b.signature.sshsig, /^-----BEGIN SSH SIGNATURE-----\n[\s\S]+-----END SSH SIGNATURE-----\n?$/);
  // the schema version and the causal context are the envelope's own
  assert.equal(c.schema, 'memev-envelope/1');
  assert.ok(Array.isArray(c.deps) && typeof c.hlc === 'string');
  // the classification is a string whose values a later schema constrains: any non-empty string passes here
  assert.equal(validateContribution(contribute(role, { classification: 'any-label-at-all' })).ok, true);
});

test('SO-F-03 AC02: the validator refuses a missing field and names it', () => {
  const { role } = world();
  const c = contribute(role);
  const errs = (env) => validateContribution(env).errors.join('|');
  for (const f of CONTRIBUTION_FIELDS) {
    const bad = retouch(c, (x) => { delete x.extension.contribution[f]; });
    const r = validateContribution(bad);
    assert.equal(r.ok, false, `without ${f}`);
    assert.match(r.errors.join('|'), new RegExp(f), `names ${f}`);
  }
  for (const f of ['principal', 'namespace', 'sshsig']) {
    const bad = retouch(c, (x) => { delete x.extension.contribution.signature[f]; });
    assert.match(errs(bad), new RegExp(f));
  }
  assert.match(errs(retouch(c, (x) => { delete x.extension; })), /contribution/);
  assert.match(errs(retouch(c, (x) => { x.extension = { other: 1 }; })), /contribution/);
  const bad = {
    sequence: [0, -1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 2],
    classification: ['', 7, null],
    subject: ['', 'writer', 'agent:other', 7],
    scope: [{ type: 'galaxy', id: 'x' }, { type: 'team' }, 'team-a', null],
    payload_hash: ['abc', '0'.repeat(64), 7],
    provenance: [{ source: '' , derived_from: [] }, { source: 'x', derived_from: ['b', 'a'] }, { source: 'x' }, 'x'],
    schema: ['memev-contribution/2', ''],
  };
  for (const [f, values] of Object.entries(bad)) for (const v of values) {
    const r = validateContribution(retouch(c, (x) => { x.extension.contribution[f] = v; }));
    assert.equal(r.ok, false, `${f} = ${JSON.stringify(v)}`);
    assert.match(r.errors.join('|'), new RegExp(f), `names ${f}`);
  }
  assert.equal(validateContribution(retouch(c, (x) => { x.extension.contribution.extra = 1; })).ok, false, 'an unknown field of the block is refused');
  assert.equal(validateContribution(retouch(c, (x) => { x.extension.contribution.signature.namespace = NAMESPACE; })).ok, false, 'the binding namespace is not a contribution namespace');
  assert.equal(validateContribution({ ...c, content_hash: '0'.repeat(64) }).ok, false, 'a bad envelope is not a contribution');
  for (const notAnEnvelope of [null, 'x', 7, []]) assert.equal(validateContribution(notAnEnvelope).ok, false);
});

test('SO-F-03 AC02: the signature is made with the role key through ssh-keygen, in its own namespace, and verifies offline', () => {
  const dir = tmpdir('memev-fed-');
  const r = makeRole(dir, 'writer');
  const other = makeRole(dir, 'other');
  const msg = 'memev-contribution v1\n{"a":1}';
  const sig = signNamespaced(msg, { keyPath: r.keyPath, principal: 'writer', namespace: CONTRIBUTION_NAMESPACE });
  assert.match(sig, /BEGIN SSH SIGNATURE/);
  const v = (m, s, o = {}) => verifyNamespaced(m, s, { principal: 'writer', publicKey: r.publicKey, namespace: CONTRIBUTION_NAMESPACE, ...o });
  assert.equal(v(msg, sig), 'valid');
  assert.equal(v(`${msg} `, sig), 'invalid', 'a changed message does not verify');
  assert.equal(v(msg, sig, { principal: 'someone' }), 'invalid', 'another principal does not verify');
  assert.equal(v(msg, sig, { publicKey: other.publicKey }), 'invalid', 'another key does not verify');
  assert.equal(v(msg, sig, { namespace: 'memev-other' }), 'invalid', 'another namespace does not verify');
  assert.equal(v(msg, `${sig}x`), 'invalid');
  assert.equal(v(msg, 'not a signature'), 'invalid');
  // the key may be given in the form OpenSSH writes, as well as the form of a role's .pub file
  assert.match(roleKeyToOpenSsh(r.publicKey), /^ssh-ed25519 [A-Za-z0-9+/=]+$/);
  assert.equal(v(msg, sig, { publicKey: roleKeyToOpenSsh(r.publicKey) }), 'valid');
  // the binding namespace is kept for bindings: neither function takes it
  assert.throws(() => signNamespaced(msg, { keyPath: r.keyPath, principal: 'writer', namespace: NAMESPACE }), (e) => e instanceof AgentBindError && e.code === 'bad-namespace');
  assert.throws(() => verifyNamespaced(msg, sig, { principal: 'writer', publicKey: r.publicKey, namespace: NAMESPACE }), (e) => e instanceof AgentBindError && e.code === 'bad-namespace');
  assert.throws(() => verifyNamespaced(msg, sig, { principal: '-oBad', publicKey: r.publicKey, namespace: CONTRIBUTION_NAMESPACE }), (e) => e instanceof AgentBindError && e.code === 'bad-principal');
  // with no ssh-keygen nothing is judged: unavailable, never invalid
  const empty = tmpdir('memev-fed-');
  const saved = process.env.PATH;
  process.env.PATH = empty;
  try { assert.equal(v(msg, sig), 'unavailable'); } finally { process.env.PATH = saved; }
  assert.equal(v(msg, sig), 'valid');
});

// ---- AC03: two steps, then append; a failure at either step is a rejected event

test('SO-F-03 AC03: a contribution that passes both steps is appended to the node\'s own operation log', () => {
  const { role, log, adm } = world();
  const c = contribute(role, { seq: 1 });
  const r = adm.admit(c);
  assert.equal(r.ok, true);
  assert.equal(r.record.type, 'federation.admitted');
  assert.deepEqual(kinds(log), ['federation.admitted']);
  const rec = records(log)[0];
  assert.deepEqual(rec.data.envelope, c, 'the envelope is stored as it came');
  assert.equal(rec.data.sequence, 1);
  assert.equal(rec.data.sender, 'node-01|agent:writer');
  assert.equal(rec.client, 'node-01');
  assert.equal(rec.agent, 'agent:writer');
  assert.equal(adm.highWater('node-01|agent:writer'), 1);
  assert.equal(log.verify().ok, true, 'the log stays a valid hash chain');
  assert.equal(adm.admit(contribute(role, { seq: 5 })).ok, true, 'a gap in the sequence is fine; only going back is refused');
  assert.equal(adm.highWater('node-01|agent:writer'), 5);
});

test('SO-F-03 AC03: a failed signature is step one, records a rejected event and appends nothing of the payload', () => {
  const { role, dir, log, adm } = world();
  const attacker = makeRole(path.join(dir, 'attacker'), 'writer');
  const forged = contribute(role, { seq: 1, sign: signer(attacker) });   // the right name, a key the node does not know
  const r = adm.admit(forged);
  assert.deepEqual({ ok: r.ok, step: r.step, code: r.code, signature_valid: r.signature_valid }, { ok: false, step: 'signature', code: 'bad_signature', signature_valid: false });
  assert.deepEqual(kinds(log), ['federation.rejected']);
  const rec = records(log)[0];
  assert.deepEqual(Object.keys(rec.data).sort(), ['code', 'content_hash', 'op_id', 'reason', 'scope', 'sender', 'sequence', 'step', 'subject']);
  assert.equal(rec.data.step, 'signature');
  assert.equal(rec.data.op_id, forged.op_id);
  assert.ok(!logText(log).includes(SECRET), 'nothing of the payload is in the log');
  assert.ok(!JSON.stringify(rec).includes(forged.extension.contribution.payload_hash), 'nor its hash');
  assert.equal(adm.highWater('node-01|agent:writer'), 0, 'a rejected contribution does not move the high-water mark');
  // a payload changed after signing is refused too
  const changed = retouch(contribute(role, { seq: 2 }), (x) => { x.payload = { note: 'changed' }; });
  assert.equal(adm.admit(changed).step, 'format', 'the payload hash no longer matches the payload');
  const resigned = retouch(contribute(role, { seq: 3 }), (x) => { x.payload = { note: 'changed' }; x.extension.contribution.payload_hash = crypto.createHash('sha256').update(canonicalize(x.payload)).digest('hex'); });
  const r3 = adm.admit(resigned);
  assert.deepEqual({ step: r3.step, code: r3.code }, { step: 'signature', code: 'bad_signature' }, 'the signature covers the payload hash');
  // an unknown subject has no key to check against
  const stranger = makeRole(path.join(dir, 'stranger'), 'stranger');
  const r4 = adm.admit(contribute(stranger, { seq: 1 }));
  assert.deepEqual({ step: r4.step, code: r4.code }, { step: 'signature', code: 'unknown_subject' });
  assert.equal(log.verify().ok, true);
});

test('SO-F-03 AC03: a failure at the authority and policy step is step two, recorded, with nothing of the payload', () => {
  const { role, log, adm } = world();
  const r = adm.admit(contribute(role, { seq: 1, classification: 'restricted' }));   // a valid signature, a label the policy does not accept
  assert.deepEqual({ ok: r.ok, step: r.step, code: r.code, signature_valid: r.signature_valid }, { ok: false, step: 'authority', code: 'policy_denied', signature_valid: true });
  const r2 = adm.admit(contribute(role, { seq: 2, classification: 'public', scope: SCOPE_B }));   // the node holds scope A
  assert.equal(r2.step, 'authority');
  assert.equal(r2.code, 'scope_mismatch');
  assert.deepEqual(kinds(log), ['federation.rejected', 'federation.rejected']);
  assert.deepEqual(records(log).map((x) => x.data.step), ['authority', 'authority']);
  assert.ok(!logText(log).includes(SECRET));
  assert.equal(adm.highWater('node-01|agent:writer'), 0);
  // deny by default: a node with no policy accepts nothing
  const w = world({ policy: { accept: [] } });
  assert.equal(w.adm.admit(contribute(w.role, { seq: 1 })).code, 'policy_denied');
  assert.deepEqual(kinds(w.log), ['federation.rejected']);
  assert.throws(() => new Admission({ log: w.log, identity: w.identity, scope: SCOPE_A }), /policy/, 'no policy at all is a configuration error, not an open door');
});

test('SO-F-03 AC03: a malformed envelope is refused as a format failure and recorded with what can be named', () => {
  const { role, log, adm } = world();
  const c = contribute(role, { seq: 1 });
  const r = adm.admit({ ...c, content_hash: '0'.repeat(64) });
  assert.deepEqual({ ok: r.ok, step: r.step, code: r.code }, { ok: false, step: 'format', code: 'bad_contribution' });
  const plain = adm.admit(buildEnvelope({ origin: { identity: 'agent:writer', node: 'node-01' }, op_id: 'op-plain', hlc: '1761990000000.0000', type: 'note.write', merge_contract: MERGE }));
  assert.equal(plain.step, 'format', 'an envelope with no contribution block is not a contribution');
  for (const junk of [null, 'x', 7, [], {}]) assert.equal(adm.admit(junk).step, 'format');
  assert.equal(records(log).length, 7);
  assert.ok(records(log).every((x) => x.type === 'federation.rejected' && x.data.step === 'format'));
  // what the log keeps of untrusted input is short text
  const long = adm.admit({ op_id: 'x'.repeat(5000), origin: 7 });
  assert.equal(long.step, 'format');
  assert.ok(JSON.stringify(records(log).at(-1)).length < 2000);
  assert.equal(log.verify().ok, true);
});

test('SO-F-03 AC03: a replayed envelope is refused and recorded; going back in the sequence is refused too', () => {
  const { role, log, adm } = world();
  const one = contribute(role, { seq: 1 }), two = contribute(role, { seq: 2 });
  assert.equal(adm.admit(one).ok, true);
  assert.equal(adm.admit(two).ok, true);
  for (const again of [one, two]) {
    const r = adm.admit(again);
    assert.deepEqual({ ok: r.ok, step: r.step, code: r.code, signature_valid: r.signature_valid }, { ok: false, step: 'replay', code: 'replay', signature_valid: true });
  }
  const back = adm.admit(contribute(role, { seq: 1, op_id: 'op-another-id', payload: { n: 'new' } }));   // new id and payload, old sequence
  assert.equal(back.code, 'replay');
  assert.deepEqual(kinds(log), ['federation.admitted', 'federation.admitted', 'federation.rejected', 'federation.rejected', 'federation.rejected']);
  assert.ok(!logText(log).includes('"new"'), 'the refused payload is not in the log');
  // the sequence is per sender: the same subject on another node, and another subject, keep their own
  assert.equal(adm.admit(contribute(role, { seq: 1, node: 'node-02' })).ok, true);
  assert.equal(adm.highWater('node-01|agent:writer'), 2);
  assert.equal(adm.highWater('node-02|agent:writer'), 1);
  assert.equal(adm.highWater('node-09|agent:nobody'), 0);
});

test('SO-F-03 AC03: the rejected event goes through the OpLog API and the module opens no store of its own', () => {
  const { role, log, adm, dir } = world();
  const seen = [];
  const append = log.append.bind(log);
  log.append = (op) => { seen.push(op.type); return append(op); };
  adm.admit(contribute(role, { seq: 1 }));
  adm.admit(contribute(role, { seq: 1 }));
  assert.deepEqual(seen, ['federation.admitted', 'federation.rejected']);
  const files = fs.readdirSync(dir).sort();
  assert.deepEqual(files, ['agents', 'oplog'], 'the only store is the vault\'s operation log');
  const code = fs.readFileSync(path.join(PKG, 'src/engine/federation/admission.mjs'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/node:fs|writeFile|appendFile|writeSync|mkdir|sqlite|\bnew Map\(\)\s*;?\s*\/\/ store/.test(code), 'it writes no file');
});

test('SO-F-03 AC03: an external admission service, when configured, runs before the node\'s own two steps', () => {
  const calls = [];
  const w = world({ external: (env) => { calls.push(env.op_id); return env.op_id.endsWith('-2') ? { ok: false, code: 'blocked', reason: 'the service said no' } : { ok: true }; } });
  assert.equal(w.adm.admit(contribute(w.role, { seq: 1 })).ok, true);
  const r = w.adm.admit(contribute(w.role, { seq: 2 }));
  assert.deepEqual({ ok: r.ok, step: r.step, code: r.code }, { ok: false, step: 'external', code: 'blocked' });
  assert.deepEqual(calls, ['op-node-01-1', 'op-node-01-2']);
  assert.deepEqual(kinds(w.log), ['federation.admitted', 'federation.rejected']);
  // it runs first: a malformed envelope never reaches it, an unsigned one does, and its refusal comes before the signature step
  const bad = world({ external: () => ({ ok: false, code: 'blocked', reason: 'no' }) });
  const forged = contribute(bad.role, { seq: 1, sign: signer(makeRole(path.join(bad.dir, 'x'), 'writer')) });
  assert.equal(bad.adm.admit(forged).step, 'external');
  // not configured: not called, and a service that throws is a refusal, never an admission
  const t = world({ external: () => { throw new Error('down'); } });
  const rt = t.adm.admit(contribute(t.role, { seq: 1 }));
  assert.deepEqual({ ok: rt.ok, step: rt.step, code: rt.code }, { ok: false, step: 'external', code: 'external_failed' });
});

test('SO-F-03 AC03: a revoked or expired key, subject or membership is refused', () => {
  const at = Date.parse('2026-06-01T00:00:00Z');
  const run = (roles, opts, expected) => {
    const w = world({ doc: (made) => identityDoc(made, opts) });
    const r = w.adm.admit(contribute(w.role, { seq: 1 }), { at });
    assert.deepEqual({ ok: r.ok, step: r.step, code: r.code }, expected, JSON.stringify(opts));
    assert.equal(kinds(w.log).at(-1), 'federation.rejected');
  };
  const keyOf = (r, more) => [{ id: r.role, alg: 'ed25519', public: r.publicKey, ...more }];
  const withKey = (more) => (made) => ({ ...identityDoc(made), subjects: [{ id: 'person:owner', type: 'person', owner: 'person:owner' }, subjectOf(made[0], { keys: keyOf(made[0], more) })] });
  for (const [more, code] of [[{ revoked_at: '2026-02-01T00:00:00Z' }, 'no_valid_key'], [{ expires: '2026-02-01T00:00:00Z' }, 'no_valid_key']]) {
    const w = world({ doc: withKey(more) });
    const r = w.adm.admit(contribute(w.role, { seq: 1 }), { at });
    assert.deepEqual({ step: r.step, code: r.code }, { step: 'signature', code: code }, JSON.stringify(more));
  }
  run(['writer'], { subjectExtra: { writer: { revoked_at: '2026-02-01T00:00:00Z' } } }, { ok: false, step: 'authority', code: 'subject_revoked' });
  run(['writer'], { subjectExtra: { writer: { expires: '2026-02-01T00:00:00Z' } } }, { ok: false, step: 'authority', code: 'subject_expired' });
  const m = (more) => [{ subject: 'agent:writer', scope: SCOPE_A.id, since: SINCE, ...more }];
  run(['writer'], { memberships: m({ revoked_at: '2026-02-01T00:00:00Z' }) }, { ok: false, step: 'authority', code: 'no_authority' });
  run(['writer'], { memberships: m({ expires: '2026-02-01T00:00:00Z' }) }, { ok: false, step: 'authority', code: 'no_authority' });
  run(['writer'], { memberships: m({ since: '2026-12-01T00:00:00Z' }) }, { ok: false, step: 'authority', code: 'no_authority' });
  // the same document and the same moment, with a live membership: admitted
  const ok = world();
  assert.equal(ok.adm.admit(contribute(ok.role, { seq: 1 }), { at }).ok, true);
});

// ---- AC04: a signature is not authority

test('SO-F-03 AC04: a valid signature from a subject that lacks authority for the scope is rejected', () => {
  // the subject is a member of scope A only, and the node holds scope B; the contribution is for scope B, signed with the real key
  const w = world({ scope: SCOPE_B });
  const c = contribute(w.role, { seq: 1, scope: SCOPE_B, classification: 'internal' });
  const r = w.adm.admit(c);
  assert.deepEqual({ ok: r.ok, step: r.step, code: r.code, signature_valid: r.signature_valid }, { ok: false, step: 'authority', code: 'no_authority', signature_valid: true });
  assert.deepEqual(kinds(w.log), ['federation.rejected']);
  assert.ok(!logText(w.log).includes(SECRET));
  // the very same envelope is admitted once the document gives the subject membership in that scope
  const doc = identityDoc(w.made, { memberships: [{ subject: 'agent:writer', scope: SCOPE_B.id, since: SINCE }] });
  const w2 = new Admission({ log: w.log, identity: doc, scope: SCOPE_B, policy: POLICY });
  assert.equal(w2.admit(c).ok, true);
  // a subject with no membership at all, and a membership in an unrelated scope, are the same refusal
  const none = world({ doc: (made) => identityDoc(made, { memberships: [] }) });
  assert.equal(none.adm.admit(contribute(none.role, { seq: 1 })).code, 'no_authority');
  // the signature check alone says valid in each of these cases: it is a separate question
  assert.equal(none.adm.verifySignature(contribute(none.role, { seq: 2 })).ok, true);
});

test('SO-F-03 AC04: authority comes from the node\'s own identity document and never from the contribution', () => {
  const w = world({ roles: ['writer', 'guest'], doc: (made) => identityDoc(made, { memberships: [{ subject: 'agent:writer', scope: SCOPE_A.id, since: SINCE }] }) });
  const [writer, guest] = w.made;
  // the guest signs with its own key but names the writer as the subject: the writer's key does not verify it
  const impostor = signContribution({
    origin: { identity: 'agent:writer', node: 'node-01' }, op_id: 'op-imp-1', hlc: '1761990000001.0000', type: 'note.write', payload: { n: 1 }, merge_contract: MERGE,
    contribution: { subject: 'agent:writer', scope: SCOPE_A, classification: 'internal', sequence: 1, provenance: { source: 'x', derived_from: [] } },
  }, { sign: signer(guest), principal: 'writer' });
  const r = w.adm.admit(impostor);
  assert.deepEqual({ step: r.step, code: r.code }, { step: 'signature', code: 'bad_signature' });
  // the guest under its own name has a key and no membership
  const own = w.adm.admit(contribute(guest, { seq: 1 }));
  assert.deepEqual({ step: own.step, code: own.code, signature_valid: own.signature_valid }, { step: 'authority', code: 'no_authority', signature_valid: true });
  // and the writer is admitted
  assert.equal(w.adm.admit(contribute(writer, { seq: 1 })).ok, true);
  // a contribution that names a scope in its own block cannot grant itself one the document lacks
  const unknownScope = w.adm.admit(contribute(writer, { seq: 2, scope: { type: 'team', id: 'team-zzz' } }));
  assert.equal(unknownScope.step, 'authority');
  // a personal scope never mixes with an organisational one
  const personal = w.adm.admit(contribute(writer, { seq: 3, scope: { type: 'personal', id: 'personal' } }));
  assert.deepEqual({ step: personal.step, code: personal.code }, { step: 'authority', code: 'scope_mismatch' });
});

// ---- AC12: replay survives a restart; a role-binding signature is not a contribution signature

test('SO-F-03 AC12: a replayed contribution is refused after the vault is closed and reopened', () => {
  const { root, v } = newVault();
  const role = makeRole(path.join(root, '..', 'agents'), 'writer');
  const doc = identityDoc([role]);
  const open = (vault) => new Admission({ log: vault.log, identity: doc, scope: SCOPE_A, policy: POLICY });
  let adm = open(v);
  const c1 = contribute(role, { seq: 1 }), c2 = contribute(role, { seq: 2 });
  assert.equal(adm.admit(c1).ok, true);
  assert.equal(adm.admit(c2).ok, true);
  assert.equal(adm.admit(c2).code, 'replay', 'refused before the restart');
  v.close();
  const v2 = new Vault(root, { commitDelayMs: 10, fsync: false, keyDir: path.join(root, '..', 'keys') }).open();
  adm = open(v2);   // a fresh object: nothing is kept in memory from before
  assert.equal(adm.highWater('node-01|agent:writer'), 2, 'the high-water mark is rebuilt from the operation log on open');
  for (const again of [c1, c2]) {
    const r = adm.admit(again);
    assert.deepEqual({ ok: r.ok, step: r.step, code: r.code }, { ok: false, step: 'replay', code: 'replay' }, 'refused after the restart');
  }
  assert.equal(adm.admit(contribute(role, { seq: 3 })).ok, true, 'the next sequence number is admitted');
  v2.close();
  const v3 = new Vault(root, { commitDelayMs: 10, fsync: false, keyDir: path.join(root, '..', 'keys') }).open();
  adm = open(v3);
  assert.equal(adm.highWater('node-01|agent:writer'), 3);
  assert.equal(adm.admit(contribute(role, { seq: 3 })).code, 'replay');
  const types = [...v3.log.iterate()].map((x) => x.type).filter((t) => t.startsWith('federation.'));
  assert.deepEqual(types, ['federation.admitted', 'federation.admitted', 'federation.rejected', 'federation.rejected', 'federation.rejected', 'federation.admitted', 'federation.rejected']);
  assert.equal(v3.log.verify().ok, true);
  v3.close();
});

test('SO-F-03 AC12: a role-binding signature presented as a contribution signature is rejected', () => {
  const dir = tmpdir('memev-fed-');
  const agents = path.join(dir, 'agents');
  const sshKey = (name) => { const f = path.join(dir, name); execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', name, '-q', '-f', f], { stdio: 'ignore' }); return f; };
  const sign = (keyFile, namespace, text) => execFileSync('ssh-keygen', ['-Y', 'sign', '-f', keyFile, '-n', namespace, '-I', 'writer'], { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
  // a real binding, made the way MEM-145 makes one: the person's key signs the role's key, in the namespace memev
  fs.mkdirSync(agents, { recursive: true });
  setupAgentRole('writer', { principal: 'alice', sshKeyPath: sshKey('person'), trustDir: path.join(dir, 'trust'), dir: agents });
  const bindingSig = fs.readFileSync(path.join(agents, 'writer.pub.sshsig'), 'utf8');
  assert.match(bindingSig, /BEGIN SSH SIGNATURE/);
  assert.equal(typeof bindingMessage('writer', 'alice', fs.readFileSync(path.join(agents, 'writer.pub'), 'utf8').trim()), 'string');
  // the node knows the writer by an OpenSSH key it can sign with, so that the right key can be used in the wrong namespace
  const roleFile = sshKey('role');
  const rolePublic = fs.readFileSync(`${roleFile}.pub`, 'utf8').trim();
  const w = world({ doc: (made) => ({ ...identityDoc(made), subjects: [{ id: 'person:owner', type: 'person', owner: 'person:owner' }, subjectOf(made[0], { keys: [{ id: 'writer', alg: 'ed25519', public: rolePublic }] })] }) });
  const base = contribute(w.role, { seq: 1 });
  const present = (sshsig, namespace) => retouch(base, (x) => { x.extension.contribution.signature = { principal: 'writer', namespace, sshsig }; });
  // (a) the binding signature, claiming the namespace it was made in
  let r = w.adm.admit(present(bindingSig, NAMESPACE));
  assert.deepEqual({ ok: r.ok, step: r.step }, { ok: false, step: 'format' }, 'the block may not name the binding namespace');
  // (b) the binding signature, claiming the contribution namespace
  r = w.adm.admit(present(bindingSig, CONTRIBUTION_NAMESPACE));
  assert.deepEqual({ ok: r.ok, step: r.step, code: r.code, signature_valid: r.signature_valid }, { ok: false, step: 'signature', code: 'bad_signature', signature_valid: false });
  // (c) the writer's own key over the right text, made in the binding namespace and claiming the contribution namespace
  const text = contributionMessage(base);
  r = w.adm.admit(present(sign(roleFile, NAMESPACE, text), CONTRIBUTION_NAMESPACE));
  assert.deepEqual({ ok: r.ok, step: r.step, code: r.code }, { ok: false, step: 'signature', code: 'bad_signature' });
  // control: the same key over the same text in the contribution namespace is admitted
  r = w.adm.admit(present(sign(roleFile, CONTRIBUTION_NAMESPACE, text), CONTRIBUTION_NAMESPACE));
  assert.equal(r.ok, true);
  assert.deepEqual(kinds(w.log), ['federation.rejected', 'federation.rejected', 'federation.rejected', 'federation.admitted']);
});

// ---- AC13: nothing under src/engine/federation can spawn a process or open a connection

const FORBIDDEN = ['child_process', 'net', 'http', 'https', 'dgram'];
function forbiddenImports(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const found = new Set();
  const names = FORBIDDEN.join('|');
  const re = new RegExp(`(?:from\\s*|import\\s*\\(\\s*|require\\s*\\(\\s*|import\\s+)['"\`](?:node:)?(${names})(?:/[a-z/]*)?['"\`]`, 'g');
  for (const m of code.matchAll(re)) found.add(m[1]);
  if (/\bprocess\.binding\b|\bprocess\.dlopen\b/.test(code)) found.add('process.binding');
  return [...found].sort();
}
test('SO-F-03 AC13: no module under src/engine/federation imports child_process, node:net, node:http, node:https or node:dgram', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.m?js$/.test(e.name) ? [path.join(d, e.name)] : []));
  const files = walk(path.join(PKG, 'src/engine/federation'));
  assert.ok(files.length >= 2, 'the scan sees the federation modules');
  assert.ok(files.some((f) => f.endsWith('admission.mjs')) && files.some((f) => f.endsWith('contribution.mjs')));
  for (const f of files) assert.deepEqual(forbiddenImports(fs.readFileSync(f, 'utf8')), [], path.relative(PKG, f));
  // the scan is not vacuous: it finds each of the five in each spelling
  const sample = [
    "import cp from 'node:child_process';", "import { exec } from 'child_process';", "import net from 'node:net';", "import net2 from 'net';",
    "import http from 'node:http';", "import https from \"node:https\";", "import dgram from 'dgram';", "const h = require('node:http');", "const x = await import('node:dgram');", "export * from 'node:net';",
  ];
  for (const line of sample) assert.notDeepEqual(forbiddenImports(line), [], line);
  assert.deepEqual(forbiddenImports("import fs from 'node:fs';\n// import net from 'node:net';\nconst s = 'net';"), []);
  // it only reads: the federation modules are not written by the test
  assert.ok(files.every((f) => fs.statSync(f).isFile()));
});
