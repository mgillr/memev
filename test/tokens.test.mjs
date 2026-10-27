import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TokenStore, allowed } from '../src/engine/tokens.mjs';
import { tmpdir, cleanup } from './helpers/tmp.mjs';
after(cleanup);

test('tokens: issue, verify, scopes, rotate, revoke, expiry, hashed at rest', () => {
  const f = path.join(tmpdir(), 'tokens.json');
  const ts = new TokenStore(f);
  const t = ts.issue({ agent: 'a', scopes: ['read'] });
  assert.ok(!fs.readFileSync(f, 'utf8').includes(t.token.split('_')[2]), 'secret not stored');
  assert.equal((fs.statSync(f).mode & 0o777).toString(8), '600');
  const id = ts.verify(t.token);
  assert.equal(id.agent, 'a');
  assert.equal(allowed(id, 'write', 'x.md'), false);
  assert.equal(ts.verify(t.token.slice(0, -1) + (t.token.endsWith('0') ? '1' : '0')), null);
  const r = ts.rotate(t.id);
  assert.equal(ts.verify(t.token), null);
  assert.ok(ts.verify(r.token));
  ts.revoke(t.id);
  assert.equal(ts.verify(r.token), null);
  const old = ts.issue({ agent: 'b' });
  ts.data.tokens[old.id].expires = new Date(Date.now() - 1000).toISOString(); ts.save();
  assert.equal(ts.verify(old.token), null);
});

test('a token minted by another process is seen without a restart', () => {
  const f = path.join(tmpdir(), 'tokens.json');
  const daemon = new TokenStore(f); daemon.save();
  const cli = new TokenStore(f);
  const t = cli.issue({ agent: 'late' });
  assert.equal(daemon.verify(t.token)?.agent, 'late');
});
