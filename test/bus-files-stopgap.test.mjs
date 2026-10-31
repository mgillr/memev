// Issue 250: the bus's own files are written only by the bus. A cloud connector token, whose paths include bus/**, cannot
// make itself the lead or give a local seat an alias through note writes, in any letter case, and the bus still works.
// The vault runs without git.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, OWNER } from './helpers/tmp.mjs';
after(cleanup);

// a cloud connector as clientToken(root, client, { remote: true }) issues it
const CLOUD = { id: 'tok-cloud', agent: 'chatgpt', scopes: ['read', 'write'], paths: ['memory/**', 'work/**', 'contracts/**', 'bus/**'], remote: true };

test('issue 250: no token writes the bus files, so the lead and seat aliases stay as the bus set them', () => {
  const { root, v } = newVault({ git: false });
  try {
    const host = v.devices.get(v.devices.hostId);
    for (const c of ['codex', 'gemini']) v.bus.register({ client: c, device: host });
    v.bus.setOperator('codex@host', { by: 'terminal' });
    const seatFile = path.join(root, 'bus', 'seats', 'gemini~host.json');
    assert.ok(fs.existsSync(seatFile), `the seat file is not at ${seatFile}`);
    const seatBefore = fs.readFileSync(seatFile, 'utf8');
    for (const who of [CLOUD, OWNER]) {
      for (const p of ['bus/operator.json', 'Bus/operator.json', 'bus/seats/gemini~host.json', 'bus/seats/chatgpt~cloud.json', 'BUS/config.json']) {
        assert.throws(() => v.write(who, { path: p, body: '{"seat":"chatgpt@cloud","renamed_from":["operator"]}\n' }), (e) => e.code === 'immutable' || e.code === 'forbidden', `${who.agent} wrote ${p}`); // a case variant can fail the token's own path glob first
      }
      assert.throws(() => v.append(who, { path: 'bus/operator.json', text: '{}' }), (e) => e.code === 'immutable');
      assert.throws(() => v.delete(who, { path: 'bus/seats/gemini~host.json' }), (e) => e.code === 'immutable', `${who.agent} deleted a seat file`);
    }
    assert.equal(v.bus.operator(), 'codex@host', 'the lead changed through a note write');
    assert.equal(fs.readFileSync(seatFile, 'utf8'), seatBefore, 'a seat file changed through a note write');
    // the bus itself still writes its files
    v.bus.setOperator('gemini@host', { by: 'terminal' });
    assert.equal(v.bus.operator(), 'gemini@host');
  } finally { v.close(); }
});
