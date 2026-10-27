// Cloud connectors are counted, never limited: a free vault keeps serving every connector, however many.
// The tier figure is what the licence report mentions; the server never refuses a connector because of it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { newVault, cleanup, tmpdir } from './helpers/tmp.mjs';
import { TIERS, seatPolicy, report, limitsFor } from '../src/engine/entitlements.mjs';
import { createServer } from '../src/server/http.mjs';
import { licensingStatus } from '../src/cli/licensing.mjs';

after(cleanup);

const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, params });
const call = (url, ip, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, 'user-agent': 'Claude-User (claude.ai)' }, body: JSON.stringify(body) });

test('MEM-085 AC01: A Free vault with more connectors than the counted figure still serves every connector', async () => {
  const counted = TIERS.free.connectors;
  assert.ok(Number.isInteger(counted) && counted > 0, 'the free tier has a counted figure');
  const total = counted + 4;
  const { v, root } = newVault();
  const env = { MEMEV_CONFIG_DIR: tmpdir('conf-') }; // no licence installed: this is the Free tier
  const server = createServer(v, { tunnelKey: () => null, env });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(limitsFor(null).tier, 'free');
    const policy = () => seatPolicy({ license: null, devices: v.devices.list() });
    const tokens = [];
    for (let i = 0; i < total; i++) tokens.push(v.devices.enroll(v.tokens, { kind: 'cloud-connector', label: `cloud-app-${i}`, policy: policy() }).token);
    assert.equal(tokens.length, total, 'every enrolment past the counted figure succeeded');

    // each connector, from its own cloud address, is served: the tool list and a real call both answer
    for (const [i, token] of tokens.entries()) {
      const ip = `203.0.113.${10 + i}`;
      const list = await call(`${base}/c/${token}/mcp`, ip, rpc(1, 'tools/list'));
      assert.equal(list.status, 200, `connector ${i + 1} of ${total}: tools/list`);
      assert.ok((await list.json()).result.tools.length > 0);
      const recall = await call(`${base}/c/${token}/mcp`, ip, rpc(2, 'tools/call', { name: 'memev_recall', arguments: { query: 'anything' } }));
      assert.equal(recall.status, 200, `connector ${i + 1} of ${total}: recall`);
      assert.notEqual((await recall.json()).result?.isError, true, `connector ${i + 1} of ${total} is not refused`);
    }

    // the connectors are counted, and the count passes the figure
    const seats = v.devices.countSeats();
    assert.equal(seats.connectors, total, 'every connector that called is counted');
    assert.ok(seats.connectors > counted);
    const r = report({ license: null, seats });
    assert.equal(r.limits.connectors, counted);
    assert.ok(r.notes.some((n) => /reported, not/.test(n)), 'the report says connectors are reported and not capped');
    assert.equal(r.can_enroll, false, 'only extra computers are capped, not connectors');
    const status = licensingStatus({ root, env, vault: v });
    assert.equal(status.usage.connectors, total);
  } finally { server.close(); v.close(); }
});
