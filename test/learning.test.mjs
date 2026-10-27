import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Vault } from '../src/engine/vault.mjs';
import { tuneRecall } from '../src/engine/tuning.mjs';
import { newVault, cleanup, OWNER } from './helpers/tmp.mjs';
after(cleanup);

test('tournament: Elo standings with advance/decompose verdicts, replayed losslessly from the log', () => {
  const { root, v } = newVault();
  for (let i = 0; i < 4; i++) v.match(OWNER, { topic: 'cache design', a: 'write-through', b: 'write-behind', winner: 'write-through', round: 'attack', why: `round ${i}` });
  v.match(OWNER, { topic: 'cache design', a: 'write-through', b: 'no cache', winner: 'write-through' });
  const s = v.tournament.standings('cache design');
  assert.equal(s[0].name, 'write-through'); assert.equal(s[0].verdict, 'advance');
  assert.equal(s.find((x) => x.name === 'write-behind').verdict, 'decompose');
  assert.throws(() => v.match(OWNER, { topic: 't', a: 'x', b: 'x' }), /two different/);
  v.close();
  fs.rmSync(`${root}/.memev/graph.json`);
  const v2 = new Vault(root, { git: false, fsync: false }).open();
  assert.deepEqual(v2.tournament.standings('cache design'), s);
  v2.close();
});

test('recall tuning: helpful items rise, unhelpful ones sink', () => {
  const { v } = newVault();
  v.write(OWNER, { path: 'notes/a.md', body: '# A\n\n## Retry policy\nThe retry policy for payments is three attempts with backoff.\n' });
  v.write(OWNER, { path: 'notes/b.md', body: '# B\n\n## Retry policy draft\nAn old draft retry policy for payments: five attempts.\n' });
  const first = v.recall(OWNER, { query: 'payments retry policy', log: false }).map((h) => h.path);
  const bad = 'notes/b.md#Retry policy draft', good = 'notes/a.md#Retry policy';
  for (let i = 0; i < 6; i++) { v.feedbackOn(OWNER, { items: [good], useful: true }); v.feedbackOn(OWNER, { items: [bad], useful: false }); }
  const t = tuneRecall(v);
  assert.equal(t.items, 2);
  const after = v.recall(OWNER, { query: 'payments retry policy', log: false }).map((h) => h.path);
  assert.equal(after[0], 'notes/a.md');
  assert.ok(v.tuning.boosts[good] > 1 && v.tuning.boosts[bad] < 1, JSON.stringify({ first, after }));
  v.close();
});
