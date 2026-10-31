// One-time invite codes: the code carries the address and a secret, the vault keeps only the hash.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
import { mintInvite, redeemInvite, decodeInvite, inviteHash, deviceKeygen } from '../src/engine/devices.mjs';
import { command } from '../src/cli/invite.mjs';

after(() => cleanup());

const allow = { can_enroll: true };

test('MEM-023 AC01: memev invite prints a code that encodes the vault address and a one-time secret', async () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    assert.equal(init.code, 0, init.err + init.out);
    // a licence that allows more computers, so the seat policy lets the code through
    const lic = { state: 'valid', tier: 'personal', seats: 3, exp: '2027-01-01' };
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    let rc;
    try {
      rc = await command(null, null, { ttl: '600', local: true }, { root: sb.root, env: sb.env, license: lic });
    } finally {
      console.log = origLog;
    }
    const inv = { code: rc, out: logs.join('\n') };
    assert.equal(inv.code, 0, inv.out);
    const code = (inv.out.match(/^code: (\S+)/m) || [])[1];
    assert.ok(code, inv.out);
    const decoded = decodeInvite(code);
    assert.equal(decoded.address, `http://127.0.0.1:${sb.port}`);
    assert.ok(decoded.secret.length >= 16);
    assert.match(inv.out, new RegExp(`^link: http://127\\.0\\.0\\.1:${sb.port}/i/${code}$`, 'm'));
    assert.match(inv.out, /\u2588/);
  } finally { sb.stop(); }
});

test('MEM-023 AC02: An invite can be redeemed once; a second redemption is refused', () => {
  const { root, v } = newVault();
  const key = deviceKeygen();
  const minted = mintInvite(root, { address: 'http://127.0.0.1:9', ttlSec: 600 });
  const first = redeemInvite(root, { code: minted.code, pubkey: key.publicKey, label: 'laptop', tokens: v.tokens, policy: allow });
  assert.equal(first.device.kind, 'remote-computer');
  assert.throws(() => redeemInvite(root, { code: minted.code, pubkey: deviceKeygen().publicKey, label: 'other', tokens: v.tokens, policy: allow }), /already used/);
  v.devices.fresh();
  assert.equal(v.devices.list().filter((d) => d.kind === 'remote-computer' && d.status === 'active').length, 1);
});

test('MEM-023 AC03: An expired invite is refused with a message saying it expired', () => {
  const { root, v } = newVault();
  const minted = mintInvite(root, { address: 'http://127.0.0.1:9', ttlSec: 30, at: Date.now() - 60_000 });
  assert.throws(() => redeemInvite(root, { code: minted.code, pubkey: deviceKeygen().publicKey, tokens: v.tokens, policy: allow }), /expired/);
  const row = JSON.parse(fs.readFileSync(path.join(root, '.memev', 'invites.json'), 'utf8')).invites[minted.id];
  assert.equal(row.used, false);
});

test('MEM-023 AC04: The secret is stored only as a hash in the vault', () => {
  const { root } = newVault();
  const minted = mintInvite(root, { address: 'http://127.0.0.1:9', ttlSec: 600 });
  const file = path.join(root, '.memev', 'invites.json');
  const text = fs.readFileSync(file, 'utf8');
  const row = JSON.parse(text).invites[minted.id];
  assert.equal(row.hash, inviteHash(minted.secret));
  assert.equal(text.includes(minted.secret), false);
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.size < 2_000_000 && fs.readFileSync(p).includes(Buffer.from(minted.secret))) assert.fail(`${p} holds the invite secret`);
    }
  };
  walk(root);
});
