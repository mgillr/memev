import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { isDirectLocal } from '../src/server/http.mjs';

const req = (peer, host = '127.0.0.1:7787') => ({ socket: { remoteAddress: peer }, headers: { host } });

after(() => { delete process.env.MEMEV_TRUST_GATEWAY; delete process.env.MEMEV_GATEWAY; });

test('MEM-097 AC01: with MEMEV_TRUST_GATEWAY=1 a peer that is not the bridge gateway is not treated as local', () => {
  process.env.MEMEV_TRUST_GATEWAY = '1';
  process.env.MEMEV_GATEWAY = '192.0.2.1';
  // the bridge gateway itself is still local, whatever host it names
  assert.equal(isDirectLocal(req('192.0.2.1', '192.0.2.128:7787')), true);
  // other private-range peers are remote, even though they were trusted before
  for (const peer of ['192.0.2.5', '198.51.100.1', '203.0.113.50', '10.1.2.3']) {
    assert.equal(isDirectLocal(req(peer)), false, `peer ${peer} must not be local`);
  }
  // loopback is unaffected
  assert.equal(isDirectLocal(req('127.0.0.1')), true);
  delete process.env.MEMEV_TRUST_GATEWAY; delete process.env.MEMEV_GATEWAY;
  // with the flag off, the gateway address is just another remote peer
  assert.equal(isDirectLocal(req('192.0.2.1')), false);
});
