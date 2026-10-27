import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Vault } from '../src/engine/vault.mjs';
import { newVault, cleanup, OWNER } from './helpers/tmp.mjs';
after(cleanup);

test('the graph connects entities across notes and explains the chain', () => {
  const { v } = newVault();
  v.write(OWNER, { path: 'notes/infra.md', body: '# Infra\n\n## Queue\nThe [[Billing Service]] publishes to [[Event Bus]].\n' });
  v.write(OWNER, { path: 'notes/ops.md', body: '# Ops\n\n## Alerts\n[[Event Bus]] lag pages the [[On Call Rota]].\n' });
  const ex = v.graph.explain('Billing Service', 'On Call Rota');
  assert.equal(ex.found, true);
  assert.deepEqual(ex.steps.map((s) => s.to), ['Event Bus', 'On Call Rota']);
  assert.ok(ex.steps[0].evidence[0].startsWith('notes/infra.md#'));
  v.link(OWNER, { from: 'Billing Service', to: 'Postgres', type: 'depends_on', why: 'ledger tables' });
  assert.ok(v.graph.neighbours('Billing Service').some((n) => n.entity === 'postgres' && n.via === 'depends_on'));
  v.close();
});

test('claims move conjecture → theory → fact, then contested and refuted, and every change is logged', () => {
  const { root, v } = newVault();
  const s = (x) => v.assert(OWNER, { subject: 'cache', predicate: 'causes', object: 'stale reads', client: 'a', ...x });
  assert.equal(s({ stance: 'speculate', strength: 0.4 }).status, 'conjecture');
  assert.equal(s({ stance: 'support', strength: 0.6, client: 'a' }).status, 'theory');
  assert.equal(s({ stance: 'support', strength: 0.8, client: 'b', path: 'notes/incident.md' }).status, 'fact');
  assert.equal(s({ stance: 'oppose', strength: 0.5, client: 'c' }).status, 'contested');
  assert.equal(s({ stance: 'oppose', strength: 0.99, client: 'd', path: 'notes/postmortem.md' }).status, 'refuted');
  const id = v.claims(OWNER, { subject: 'cache' })[0].id;
  const prov = v.provenance(OWNER, { claim: id });
  assert.deepEqual(prov.status_history.map((h) => h.to), ['conjecture', 'theory', 'fact', 'contested', 'refuted']);
  assert.equal(prov.evidence.length, 5);
  v.close();
  // lossless: a fresh process rebuilds the same graph from the log alone (no snapshot)
  fs.rmSync(`${root}/.memev/graph.json`);
  const v2 = new Vault(root, { git: false, fsync: false }).open();
  const c2 = v2.claims(OWNER, { subject: 'cache' })[0];
  assert.equal(c2.status, 'refuted');
  assert.equal(v2.provenance(OWNER, { claim: id }).status_history.length, 5);
  v2.close();
});

test('provenance shows where a note came from and every session that used it', () => {
  const { v } = newVault();
  const r = v.remember(OWNER, { text: 'The staging database is reset every Sunday night', kind: 'fact', client: 'writer' });
  v.recall(OWNER, { query: 'when is staging reset', client: 'reader-1', session: 's1' });
  v.recall(OWNER, { query: 'staging database reset', client: 'reader-2', session: 's2' });
  const p = v.provenance(OWNER, { path: r.path });
  assert.equal(p.written_total, 1);
  assert.equal(p.written[0].client, 'writer');
  assert.deepEqual(p.used.map((u) => u.client), ['reader-1', 'reader-2']);
  const hit = v.recall(OWNER, { query: 'staging reset', log: false })[0];
  assert.equal(hit.used, 2);
  v.close();
});
