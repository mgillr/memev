// SPDX-License-Identifier: Apache-2.0
// SO-F-01: the identity and scopes model, version 1. Subjects, scopes and memberships have a schema and a validator;
// every authenticated request and every store write resolves to a subject and a scope; a personal credential never
// reaches an organisational scope, nor the reverse; the role bindings are subjects of the same model; and all of it
// works with the network off. Test names start with the id the contract's checks select on.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import path from 'node:path';
import { newVault, cleanup, PKG } from './helpers/tmp.mjs';
import { createServer } from '../src/server/http.mjs';
import { handle } from '../src/server/mcp.mjs';
import { allowed } from '../src/engine/tokens.mjs';
import {
  SUBJECT_TYPES, SCOPE_TYPES, IDENTITY_SCHEMA, PERSONAL_SCOPE, OWNER_SUBJECT,
  validateSubject, validateScope, validateMembership, validateIdentityDocument,
  resolveRequest, authorizeScope, vaultScope, subjectsFromBindings, resolveBinding,
} from '../src/engine/identity.mjs';

after(cleanup);

const ORG = { type: 'organisation', id: 'org-1' };
const PERSON = { id: 'person:p1', type: 'person', owner: 'person:p1' };
const SCHEMA = JSON.parse(fs.readFileSync(path.join(PKG, 'docs', 'schemas', 'identity-v1.json'), 'utf8'));

// One valid document that holds every subject type and every scope type.
const KEY = { id: 'k1', alg: 'ed25519', public: 'AAAA', created: '2026-11-01T00:00:00.000Z', expires: null, revoked_at: null };
const FIXTURE = {
  schema: IDENTITY_SCHEMA,
  scopes: [
    { id: 'personal', type: 'personal' }, { id: 'team-1', type: 'team' }, { id: 'dept-1', type: 'department' },
    { id: 'proj-1', type: 'project' }, { id: 'prog-1', type: 'programme' }, { id: 'port-1', type: 'portfolio' },
    { id: 'site-1', type: 'site' }, { id: 'org-1', type: 'organisation' },
  ],
  subjects: [
    { ...PERSON, keys: [KEY], expires: null, revoked_at: null },
    { id: 'agent:reviewer', type: 'agent', owner: 'person:p1', role: 'reviewer', keys: [KEY] },
    { id: 'device:d1', type: 'device', owner: 'person:p1', keys: [KEY], expires: '2027-01-01T00:00:00.000Z' },
    { id: 'node:n1', type: 'node', owner: 'person:p1', keys: [KEY] },
    { id: 'operator:o1', type: 'operator', owner: 'person:p1', keys: [KEY] },
    { id: 'service:s1', type: 'service', owner: 'person:p1', keys: [KEY], revoked_at: '2026-11-02T00:00:00.000Z' },
  ],
  memberships: [
    { subject: 'person:p1', scope: 'org-1', since: '2026-11-01T00:00:00.000Z', expires: null, revoked_at: null },
    { subject: 'agent:reviewer', scope: 'proj-1', since: '2026-11-01T00:00:00.000Z' },
  ],
};

// A vault whose own scope is personal (the default) and a vault whose own scope is an organisation.
function vaults() {
  const p = newVault({ git: false });
  const o = newVault({ git: false });
  o.v.config.identity = { scope: ORG };
  const orgToken = (v, extra = {}) => v.tokens.issue({ agent: 'work-seat', scopes: ['read', 'write'], paths: ['**'], identityScope: ORG, subject: PERSON, ...extra });
  const todayToken = (v, agent = 'app', extra = {}) => v.tokens.issue({ agent, scopes: ['read', 'write'], paths: ['**'], ...extra });
  return { p, o, orgToken, todayToken };
}
const lastOf = (r) => `${r.code}: ${r.reason}`;

test('SO-F-01 AC02: the schema names the six subject types, the eight scope types, keys, expiry, revocation and memberships', () => {
  assert.equal(SCHEMA.properties.schema.const, IDENTITY_SCHEMA);
  assert.deepEqual(SCHEMA.$defs.subject.properties.type.enum, SUBJECT_TYPES);
  assert.deepEqual(SUBJECT_TYPES, ['person', 'agent', 'device', 'node', 'operator', 'service']);
  assert.deepEqual(SCHEMA.$defs.scope.properties.type.enum, SCOPE_TYPES);
  assert.deepEqual(SCOPE_TYPES, ['personal', 'team', 'department', 'project', 'programme', 'portfolio', 'site', 'organisation']);
  for (const f of ['keys', 'expires', 'revoked_at', 'owner']) assert.ok(SCHEMA.$defs.subject.properties[f], `subject.${f}`);
  assert.ok(SCHEMA.$defs.subject.required.includes('owner'));
  assert.ok(SCHEMA.$defs.scope.required.includes('type'));
  for (const f of ['expires', 'revoked_at']) assert.ok(SCHEMA.$defs.key.properties[f], `key.${f}`);
  assert.deepEqual(SCHEMA.$defs.membership.required.slice().sort(), ['scope', 'since', 'subject']);
  // a token's identity scope has a field of its own, with the same scope types
  assert.deepEqual(SCHEMA.$defs.tokenIdentity.properties.identity_scope.properties.type.enum, SCOPE_TYPES);
  assert.ok(!('scopes' in SCHEMA.$defs.tokenIdentity.properties.identity_scope.properties));
});

test('SO-F-01 AC02: the validator accepts the fixtures', () => {
  const r = validateIdentityDocument(FIXTURE);
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  for (const s of FIXTURE.subjects) assert.deepEqual(validateSubject(s), [], s.id);
  for (const s of FIXTURE.scopes) assert.deepEqual(validateScope(s), [], s.id);
  for (const m of FIXTURE.memberships) assert.deepEqual(validateMembership(m), [], m.subject);
  assert.deepEqual(validateIdentityDocument({ schema: IDENTITY_SCHEMA, subjects: [], scopes: [], memberships: [] }).errors, []);
});

test('SO-F-01 AC02: the validator refuses a subject without an owner, and one whose owner is not a person subject', () => {
  const { owner, ...noOwner } = FIXTURE.subjects[2];
  assert.ok(validateSubject(noOwner).some((e) => /owner/.test(e)));
  assert.ok(validateSubject({ ...noOwner, owner: '' }).some((e) => /owner/.test(e)));
  assert.ok(validateSubject({ ...noOwner, owner: 'device:d9' }).some((e) => /owner/.test(e)));
  assert.ok(validateSubject({ ...PERSON, owner: 'person:p2' }).some((e) => /owner/.test(e)), 'a person owns itself');
  const doc = { ...FIXTURE, subjects: [...FIXTURE.subjects.slice(0, 2), noOwner] };
  const r = validateIdentityDocument(doc);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /owner/.test(e)));
  assert.equal(validateIdentityDocument({ ...FIXTURE, subjects: [...FIXTURE.subjects, { ...FIXTURE.subjects[2], owner: 'person:nobody' }] }).ok, false, 'an owner must be a subject of the document');
});

test('SO-F-01 AC02: the validator refuses a scope without a type, an unknown type, a subject of an unknown type and a provider on an agent', () => {
  assert.ok(validateScope({ id: 'x' }).some((e) => /type/.test(e)));
  assert.ok(validateScope({ id: 'x', type: 'galaxy' }).some((e) => /type/.test(e)));
  assert.ok(validateScope({ type: 'team' }).some((e) => /id/.test(e)));
  const r = validateIdentityDocument({ ...FIXTURE, scopes: [{ id: 'x' }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /type/.test(e)));
  assert.ok(validateSubject({ ...FIXTURE.subjects[2], type: 'robot' }).some((e) => /type/.test(e)));
  assert.ok(validateSubject({ ...FIXTURE.subjects[1], provider: 'any' }).some((e) => /provider/.test(e)), 'an agent subject names a role, never a provider');
  assert.ok(validateSubject({ ...FIXTURE.subjects[1], role: undefined }).some((e) => /role/.test(e)));
  assert.ok(validateMembership({ subject: 'person:p1', since: 'x' }).length > 0);
  assert.ok(validateSubject({ ...PERSON, keys: [{ ...KEY, alg: 'none' }] }).some((e) => /key/.test(e)));
});

test('SO-F-01 AC02: a token\'s identity scope is a field of its own, distinct from read, write and admin', () => {
  const { p, orgToken, todayToken } = vaults();
  const t = orgToken(p.v);
  const rec = p.v.tokens.data.tokens[t.id];
  assert.deepEqual(rec.identity_scope, ORG);
  assert.deepEqual(rec.scopes, ['read', 'write'], 'the permission scopes are untouched');
  const id = p.v.tokens.verify(t.token);
  assert.deepEqual(id.identity_scope, ORG);
  assert.deepEqual(id.scopes, ['read', 'write']);
  assert.throws(() => p.v.tokens.issue({ agent: 'x', scopes: ['read', 'organisation'] }), /unknown scope/);
  assert.throws(() => p.v.tokens.issue({ agent: 'x', identityScope: { type: 'read' }, subject: PERSON }), /identity scope/);
  assert.throws(() => p.v.tokens.issue({ agent: 'x', identityScope: ORG }), /subject/, 'an organisational token names its subject');
  assert.throws(() => p.v.tokens.issue({ agent: 'x', identityScope: ORG, subject: { id: 'device:d', type: 'device' } }), /owner/);
  const old = todayToken(p.v);
  assert.equal('identity_scope' in p.v.tokens.data.tokens[old.id], false, 'a token issued the way it is today gains no field');
  assert.equal(p.v.tokens.rotate(t.id).id, t.id);
  assert.deepEqual(p.v.tokens.verify(p.v.tokens.rotate(t.id).token).identity_scope, ORG, 'a rotation keeps the identity scope');
  assert.ok(allowed(id, 'write', 'memory/a.md'), 'allowed() still reads only read, write and admin');
});

test('SO-F-01 AC03: a device token and a client token resolve to the owner subject and the personal scope; a business token and a business binding to their organisational scope', () => {
  const { p, orgToken, todayToken } = vaults();
  const device = p.v.tokens.verify(todayToken(p.v, 'laptop', { remote: true }).token);
  const client = p.v.tokens.verify(todayToken(p.v, 'editor').token);
  for (const id of [device, client]) {
    const r = resolveRequest(id);
    assert.equal(r.ok, true, lastOf(r));
    assert.deepEqual(r.subject, OWNER_SUBJECT);
    assert.deepEqual(r.scope, PERSONAL_SCOPE);
  }
  const biz = resolveRequest(p.v.tokens.verify(orgToken(p.v).token));
  assert.equal(biz.ok, true, lastOf(biz));
  assert.deepEqual(biz.scope, ORG);
  assert.equal(biz.subject.id, PERSON.id);
  const bound = resolveBinding({ role: 'reviewer', principal: 'p1' }, { scope: ORG });
  assert.equal(bound.ok, true, lastOf(bound));
  assert.deepEqual(bound.scope, ORG);
  assert.equal(bound.subject.type, 'agent');
});

test('SO-F-01 AC03: a request that resolves to no subject or no scope is refused with a reason', () => {
  const cases = [
    [null, 'no_identity'],
    [undefined, 'no_identity'],
    [{ scopes: ['read'], paths: ['**'] }, 'no_subject'],
    [{ agent: 'a', scopes: ['read'], paths: ['**'], identity_scope: { id: 'x' } }, 'bad_scope'],
    [{ agent: 'a', scopes: ['read'], paths: ['**'], identity_scope: { type: 'galaxy', id: 'x' } }, 'bad_scope'],
    [{ agent: 'a', scopes: ['read'], paths: ['**'], identity_scope: ORG }, 'no_subject'],
    [{ agent: 'a', scopes: ['read'], paths: ['**'], identity_scope: ORG, subject: { id: 'device:d', type: 'device' } }, 'no_subject'],
    [{ agent: 'a', scopes: ['read'], paths: ['**'], identity_scope: ORG, subject: { ...PERSON, revoked_at: '2026-01-01T00:00:00.000Z' } }, 'revoked'],
    [{ agent: 'a', scopes: ['read'], paths: ['**'], identity_scope: ORG, subject: { ...PERSON, expires: '2026-01-01T00:00:00.000Z' } }, 'expired'],
  ];
  for (const [id, code] of cases) {
    const r = resolveRequest(id, { at: Date.parse('2026-11-01T00:00:00.000Z') });
    assert.equal(r.ok, false, JSON.stringify(id));
    assert.equal(r.code, code, JSON.stringify(id));
    assert.ok(typeof r.reason === 'string' && r.reason.length > 10, 'a refusal carries a reason');
    assert.equal(r.subject, undefined);
  }
});

test('SO-F-01 AC03: over HTTP and MCP one request of each kind resolves, and the open routes are unchanged', async () => {
  const { p, orgToken, todayToken } = vaults();
  const server = createServer(p.v, { tunnelKey: () => 'k'.repeat(32) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (tok, route, init = {}) => fetch(base + route, { ...init, headers: { ...(tok ? { authorization: `Bearer ${tok}` } : {}), 'content-type': 'application/json', ...init.headers } }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  try {
    const open = await call(null, '/healthz');
    assert.equal(open.status, 200);
    assert.equal((await call(null, '/.well-known/oauth-authorization-server')).status, 200);
    assert.equal((await call(null, '/v1/status')).status, 401, 'a route that needed a token still does');
    // one Personal request with today's token still passes
    const today = todayToken(p.v, 'editor').token;
    assert.equal((await call(today, '/v1/status')).status, 200);
    const put = await call(today, '/v1/notes/memory/id-1.md', { method: 'PUT', body: JSON.stringify({ body: 'one' }) });
    assert.equal(put.status, 200, JSON.stringify(put.json));
    // the MCP route resolves too: a personal token lists, an unresolvable credential is refused with a reason
    const mcp = (tok) => call(tok, '/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memev_list', arguments: {} } }) });
    const ok = await mcp(today);
    assert.equal(ok.json.result.isError, undefined);
    // a business token on a personal vault is refused at the boundary, with its reason
    const org = await call(orgToken(p.v).token, '/v1/status');
    assert.equal(org.status, 403);
    assert.equal(org.json.error, 'scope_mismatch');
    assert.match(org.json.error_description, /organisational/);
    const orgMcp = await mcp(orgToken(p.v).token);
    assert.equal(orgMcp.status, 403);
  } finally { await new Promise((r) => server.close(r)); p.v.close(); }
  // the MCP handler resolves on its own when the transport did not
  // (memev_contract_list reads no note, so only the handler's own resolution can refuse it)
  const askList = (id, ctx) => handle(p.v, { jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'memev_contract_list', arguments: {} } }, ctx);
  const refused = await askList(2, { identity: { scopes: ['read'], paths: ['**'] }, client: 'x', local: true });
  assert.equal(refused.result.isError, true);
  assert.match(refused.result.content[0].text, /^no_subject: /);
  const mismatch = await askList(4, { identity: p.v.tokens.verify(orgToken(p.v).token), client: 'x', local: true });
  assert.equal(mismatch.result.isError, true);
  assert.match(mismatch.result.content[0].text, /^scope_mismatch: .*organisational/);
  const fine = await askList(3, { identity: p.v.tokens.verify(todayToken(p.v).token), client: 'x', local: true });
  assert.equal(fine.result.isError, undefined);
});

test('SO-F-01 AC03: every store write resolves a subject and a scope first', () => {
  const { p, todayToken } = vaults();
  const personal = p.v.tokens.verify(todayToken(p.v).token);
  assert.ok(p.v.write(personal, { path: 'memory/w1.md', body: 'a' }));
  assert.ok(p.v.append(personal, { path: 'memory/w1.md', text: 'b' }));
  assert.ok(p.v.remember(personal, { text: 'a fact worth keeping about the model', kind: 'note' }));
  assert.ok(p.v.delete(personal, { path: 'memory/w1.md' }));
  const none = { agent: 'a', scopes: ['read', 'write'], paths: ['**'], identity_scope: { type: 'galaxy', id: 'x' } };
  for (const [name, fn] of [['write', () => p.v.write(none, { path: 'memory/w2.md', body: 'a' })], ['append', () => p.v.append(none, { path: 'memory/w1.md', text: 'x' })], ['delete', () => p.v.delete(none, { path: 'memory/w1.md' })], ['remember', () => p.v.remember(none, { text: 'a fact worth keeping', kind: 'note' })], ['plan', () => p.v.tasksPlan(none, { project: 'pp', tasks: [] })]]) {
    assert.throws(fn, (e) => e.code === 'forbidden' && /scope/.test(e.message), name);
  }
  assert.equal(fs.existsSync(path.join(p.root, 'memory', 'w2.md')), false, 'nothing was written');
  assert.deepEqual(vaultScope(p.v.config), PERSONAL_SCOPE);
  assert.deepEqual(vaultScope({ identity: { scope: ORG } }), ORG);
  assert.equal(vaultScope({ identity: { scope: { id: 'x' } } }).ok, false, 'a vault that names an invalid scope refuses everything');
  assert.throws(() => { p.v.config.identity = { scope: { id: 'x' } }; p.v.write(personal, { path: 'memory/w3.md', body: 'a' }); }, (e) => e.code === 'forbidden');
});

test('SO-F-01 AC04: a personal token cannot read or write an organisational scope, and the reverse', () => {
  const { p, o, orgToken, todayToken } = vaults();
  const personalOnOrg = o.v.tokens.verify(todayToken(o.v, 'editor').token);
  const orgOnPersonal = p.v.tokens.verify(orgToken(p.v).token);
  const orgOnOrg = o.v.tokens.verify(orgToken(o.v).token);
  const personalOnPersonal = p.v.tokens.verify(todayToken(p.v, 'editor').token);
  // both ways, read and write, on the store
  o.v.write(orgOnOrg, { path: 'memory/shared.md', body: 'org note' });
  p.v.write(personalOnPersonal, { path: 'memory/mine.md', body: 'personal note' });
  const refused = (fn) => assert.throws(fn, (e) => e.code === 'forbidden' && /(personal|organisational)/.test(e.message));
  refused(() => o.v.get(personalOnOrg, 'memory/shared.md'));
  refused(() => o.v.list(personalOnOrg));
  refused(() => o.v.write(personalOnOrg, { path: 'memory/x.md', body: 'no' }));
  refused(() => p.v.get(orgOnPersonal, 'memory/mine.md'));
  refused(() => p.v.list(orgOnPersonal));
  refused(() => p.v.write(orgOnPersonal, { path: 'memory/y.md', body: 'no' }));
  assert.equal(fs.existsSync(path.join(o.root, 'memory', 'x.md')), false);
  assert.equal(fs.existsSync(path.join(p.root, 'memory', 'y.md')), false);
  // the same scope still works, and so does an admin permission: it is a permission, not a scope
  assert.equal(o.v.get(orgOnOrg, 'memory/shared.md').body.trim(), 'org note');
  const adminOnOrg = o.v.tokens.verify(o.v.tokens.issue({ agent: 'adm', scopes: ['read', 'write', 'admin'], paths: ['**'] }).token);
  refused(() => o.v.get(adminOnOrg, 'memory/shared.md'));
  // the decision itself, both ways, and between two organisational scopes
  assert.equal(authorizeScope(PERSONAL_SCOPE, ORG).ok, false);
  assert.equal(authorizeScope(ORG, PERSONAL_SCOPE).ok, false);
  assert.equal(authorizeScope(ORG, ORG).ok, true);
  assert.equal(authorizeScope(PERSONAL_SCOPE, PERSONAL_SCOPE).ok, true);
  assert.equal(authorizeScope(ORG, { type: 'organisation', id: 'org-2' }).ok, false);
  assert.equal(authorizeScope(ORG, { type: 'team', id: 'org-1' }).ok, false, 'a scope of another type is another scope');
  // a binding is held to the same rule
  const bindingP = resolveBinding({ role: 'reviewer', principal: 'p1' }, { scope: PERSONAL_SCOPE, target: ORG });
  const bindingO = resolveBinding({ role: 'reviewer', principal: 'p1' }, { scope: ORG, target: PERSONAL_SCOPE });
  assert.equal(bindingP.ok, false); assert.match(bindingP.reason, /personal/);
  assert.equal(bindingO.ok, false); assert.match(bindingO.reason, /organisational/);
  assert.equal(resolveBinding({ role: 'reviewer', principal: 'p1' }, { scope: ORG, target: ORG }).ok, true);
});

test('SO-F-01 AC04: the same refusal holds over HTTP, both ways', async () => {
  const { p, o, orgToken, todayToken } = vaults();
  const serve = async (v) => { const s = createServer(v, { tunnelKey: () => 'k'.repeat(32) }); await new Promise((r) => s.listen(0, '127.0.0.1', r)); return { s, base: `http://127.0.0.1:${s.address().port}` }; };
  const a = await serve(p.v); const b = await serve(o.v);
  const req = (base, tok, method, route, body) => fetch(base + route, { method, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  try {
    for (const [base, tok] of [[a.base, orgToken(p.v).token], [b.base, todayToken(o.v).token]]) {
      for (const [m, route, body] of [['GET', '/v1/notes/memory/x.md'], ['PUT', '/v1/notes/memory/x.md', { body: 'no' }]]) {
        const r = await req(base, tok, m, route, body);
        assert.equal(r.status, 403, `${m} ${route}`);
        assert.equal(r.json.error, 'scope_mismatch');
      }
    }
    assert.notEqual((await req(b.base, orgToken(o.v).token, 'PUT', '/v1/notes/memory/ok.md', { body: 'yes' })).status, 403);
  } finally { await new Promise((r) => a.s.close(r)); await new Promise((r) => b.s.close(r)); p.v.close(); o.v.close(); }
});

// the vault's role bindings are files under the agents directory: <role>.pub, <role>.pub.principal, <role>.pub.sshsig
function agentsDirWith(roles) {
  const dir = path.join(newVault({ git: false }).root, '.memev', 'agents-fixture');
  fs.mkdirSync(dir, { recursive: true });
  for (const [role, principal] of Object.entries(roles)) {
    fs.writeFileSync(path.join(dir, `${role}.pub`), `ssh-ed25519 AAAA${role}\n`);
    if (principal) { fs.writeFileSync(path.join(dir, `${role}.pub.principal`), `${principal}\n`); fs.writeFileSync(path.join(dir, `${role}.pub.sshsig`), 'sig\n'); }
  }
  return dir;
}
const listing = (d) => fs.readdirSync(d).sort().map((f) => `${f}:${fs.readFileSync(path.join(d, f), 'utf8')}`);

test('SO-F-01 AC05: a role binding resolves to an agent subject bound to a person subject, with no second identity store', () => {
  const dir = agentsDirWith({ reviewer: 'p1', builder: 'p2', loose: null, forged: 'p3' });
  const before = listing(dir);
  const verify = (role, { principal }) => (role === 'forged' ? 'invalid' : fs.existsSync(path.join(dir, `${role}.pub.sshsig`)) && principal ? 'bound' : 'unbound');
  const r = subjectsFromBindings(dir, { allowedSigners: '/nonexistent', verify });
  const byId = Object.fromEntries(r.subjects.map((s) => [s.id, s]));
  assert.deepEqual(Object.keys(byId).sort(), ['agent:builder', 'agent:reviewer', 'person:p1', 'person:p2']);
  assert.equal(byId['agent:reviewer'].type, 'agent');
  assert.equal(byId['agent:reviewer'].owner, 'person:p1', 'the agent subject is bound to the person subject');
  assert.equal(byId['agent:reviewer'].role, 'reviewer');
  assert.equal('provider' in byId['agent:reviewer'], false, 'an agent subject names a role, never a provider');
  assert.deepEqual(byId['person:p1'], { ...PERSON, keys: [], id: 'person:p1' });
  assert.deepEqual(r.skipped.map((s) => `${s.role}:${s.status}`).sort(), ['forged:invalid', 'loose:unbound']);
  const doc = { schema: IDENTITY_SCHEMA, scopes: [{ id: 'personal', type: 'personal' }], subjects: r.subjects, memberships: [] };
  assert.deepEqual(validateIdentityDocument(doc).errors, [], 'the subjects it makes are subjects of the model');
  // nothing was written: the agents directory is the only record, and the bindings are read from it
  assert.deepEqual(listing(dir), before);
  const src = fs.readFileSync(path.join(PKG, 'src', 'engine', 'identity.mjs'), 'utf8');
  assert.ok(!/writeFileSync|writeAtomic|writePrivate|appendFile|mkdirSync/.test(src), 'identity.mjs holds no store of its own');
});

test('SO-F-01 AC05: without OpenSSH a binding is not trusted, and the real verifier is the default', () => {
  const dir = agentsDirWith({ reviewer: 'p1' });
  const r = subjectsFromBindings(dir, { allowedSigners: path.join(dir, 'allowed_signers') });
  assert.equal(r.subjects.some((s) => s.type === 'agent'), false);
  assert.equal(r.skipped.length, 1);
  assert.notEqual(r.skipped[0].status, 'bound');
  assert.equal(subjectsFromBindings(path.join(dir, 'missing'), { allowedSigners: '/x' }).subjects.length, 0);
});

test('SO-F-01 AC13: subject and scope resolution works with every non-loopback network call made to throw', async () => {
  const { p, o, orgToken, todayToken } = vaults();
  const loop = (h) => ['127.0.0.1', 'localhost', '::1', '[::1]', undefined, null, ''].includes(h);
  const calls = [];
  const trap = (name) => (...a) => { calls.push(name); throw new Error(`network call blocked: ${name}`); };
  const saved = [];
  const swap = (obj, key, fn) => { saved.push([obj, key, obj[key]]); obj[key] = fn; };
  const guard = (obj, key, hostOf) => { const real = obj[key]; swap(obj, key, function (...a) { if (loop(hostOf(a))) return real.apply(this, a); return trap(`${key}`)(); }); };
  swap(globalThis, 'fetch', trap('fetch'));
  guard(net, 'connect', (a) => (typeof a[0] === 'object' ? a[0].host : a[1]));
  guard(net, 'createConnection', (a) => (typeof a[0] === 'object' ? a[0].host : a[1]));
  guard(net.Socket.prototype, 'connect', (a) => (typeof a[0] === 'object' ? a[0].host : a[1]));
  guard(http, 'request', (a) => (typeof a[0] === 'object' ? a[0].hostname || a[0].host : new URL(String(a[0])).hostname));
  swap(https, 'request', trap('https.request'));
  swap(https, 'get', trap('https.get'));
  swap(dns, 'lookup', trap('dns.lookup'));
  swap(dns.promises, 'lookup', trap('dns.promises.lookup'));
  swap(dns, 'resolve', trap('dns.resolve'));
  try {
    const personal = p.v.tokens.verify(todayToken(p.v, 'editor').token);
    const biz = o.v.tokens.verify(orgToken(o.v).token);
    const a = resolveRequest(personal, { target: vaultScope(p.v.config) });
    const b = resolveRequest(biz, { target: vaultScope(o.v.config) });
    const c = resolveRequest(personal, { target: vaultScope(o.v.config) });
    assert.equal(a.ok, true); assert.deepEqual(a.scope, PERSONAL_SCOPE);
    assert.equal(b.ok, true); assert.deepEqual(b.scope, ORG);
    assert.equal(c.ok, false);
    assert.ok(p.v.write(personal, { path: 'memory/offline.md', body: 'still works' }));
    assert.ok(o.v.write(biz, { path: 'memory/offline.md', body: 'still works' }));
    assert.equal(resolveBinding({ role: 'reviewer', principal: 'p1' }, { scope: PERSONAL_SCOPE }).ok, true);
    assert.deepEqual(validateIdentityDocument(FIXTURE).errors, []);
    assert.deepEqual(calls, [], 'no network call was attempted');
    // and the trap itself is live: a non-loopback call throws, so a hidden call would have been seen
    await assert.rejects(async () => fetch('https://example.invalid/'), /network call blocked/);
    assert.throws(() => dns.lookup('example.invalid', () => {}), /network call blocked/);
    assert.throws(() => http.request('http://example.invalid/'), /network call blocked/);
  } finally { for (const [obj, key, fn] of saved.reverse()) obj[key] = fn; p.v.close(); o.v.close(); }
  const src = fs.readFileSync(path.join(PKG, 'src', 'engine', 'identity.mjs'), 'utf8');
  assert.ok(!/node:(net|http|https|dns|tls|dgram)|\bfetch\(/.test(src), 'identity.mjs imports no network module');
});
