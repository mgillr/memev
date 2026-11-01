// SPDX-License-Identifier: Apache-2.0
// A sandbox node for the federation tests: its own folder, its own operation log, its own identity document, and a role key
// that can sign a contribution through the real ssh-keygen path. Nothing here opens a connection.
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from './tmp.mjs';
import { OpLog } from '../../src/engine/oplog.mjs';
import { deviceKeygen } from '../../src/engine/devices.mjs';
import { signNamespaced, CONTRIBUTION_NAMESPACE } from '../../src/engine/agentid-bind.mjs';
import { signContribution } from '../../src/engine/federation/contribution.mjs';

export const SINCE = '2026-01-01T00:00:00Z';
export const MERGE = { strategy: 'last-writer', mapping_version: 'map-1', policy: { retain: '30d' } };

export function makeRole(dir, role) {
  fs.mkdirSync(dir, { recursive: true });
  const { privateKeyPem, publicKey } = deviceKeygen();
  const keyPath = path.join(dir, role);
  fs.writeFileSync(keyPath, privateKeyPem, { mode: 0o600 });
  fs.writeFileSync(`${keyPath}.pub`, `${publicKey}\n`, { mode: 0o644 });
  return { role, keyPath, publicKey };
}

export const subjectOf = (r) => ({ id: `agent:${r.role}`, type: 'agent', owner: 'person:owner', role: r.role, keys: [{ id: r.role, alg: 'ed25519', public: r.publicKey }] });

/** An identity document for a node: the person, the roles it knows (with their public keys) and a membership of each in each scope. */
export function identityDoc(roles, scopes) {
  return {
    schema: 'memev-identity/1',
    subjects: [{ id: 'person:owner', type: 'person', owner: 'person:owner' }, ...roles.map(subjectOf)],
    scopes: scopes.map((s) => ({ id: s.id, type: s.type })),
    memberships: roles.flatMap((r) => scopes.map((s) => ({ subject: `agent:${r.role}`, scope: s.id, since: SINCE }))),
  };
}

/** A sandbox node: a folder, an operation log, a role key. Open the log again with `reopen()` to model a restart. */
export function sandboxNode(name, role = 'writer') {
  const dir = tmpdir(`memev-${name}-`);
  const key = makeRole(path.join(dir, 'agents'), role);
  const open = () => new OpLog(path.join(dir, 'oplog'), { fsync: false, deviceId: `dev-${name}` }).open();
  const node = { name, dir, key, log: open(), reopen() { node.log = open(); return node.log; } };
  return node;
}

const signer = (r) => (message) => signNamespaced(message, { keyPath: r.keyPath, principal: r.role, namespace: CONTRIBUTION_NAMESPACE });

/** A signed contribution from `key`, written on `node` for `scope`: the envelope a sender's outbox would hold. */
export function contribute(key, { node, seq, scope, classification = 'internal', payload = { n: seq } }) {
  return signContribution({
    origin: { identity: `agent:${key.role}`, node },
    op_id: `op-${node}-${seq}`,
    hlc: `${String(1761990000000 + seq)}.0000`,
    type: 'note.write',
    project: 'proj-1',
    payload,
    merge_contract: MERGE,
    contribution: { subject: `agent:${key.role}`, scope, classification, sequence: seq, provenance: { source: 'sandbox-test', derived_from: [] } },
  }, { sign: signer(key), principal: key.role });
}
