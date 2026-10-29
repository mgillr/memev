// The address in an invite must be reachable by the computer it is sent to: the tunnel address when
// the secure link is on, the loopback address only when asked for, and a refusal that names
// memev cloud on otherwise.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';
import { command } from '../src/cli/invite.mjs';

after(() => cleanup());

test('REV-020 AC01: with the secure link off and no --local flag, memev invite exits non-zero and names memev cloud on instead of minting a 127.0.0.1 address', () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--no-connect']);
    assert.equal(init.code, 0, init.err + init.out);
    const inv = sb.run(['invite']);
    assert.notEqual(inv.code, 0, inv.out);
    assert.match(inv.out + inv.err, /memev cloud on/);
    assert.doesNotMatch(inv.out, /^code: /m);
    assert.doesNotMatch(inv.out, /127\.0\.0\.1/);
    const file = path.join(sb.root, '.memev', 'invites.json');
    const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { invites: {} };
    assert.equal(Object.keys(data.invites || {}).length, 0, 'no invite was minted');
  } finally { sb.stop(); }
});

test('REV-020 AC01: an install that answered no to cloud access (asked and not enabled) still refuses without --local and names memev cloud on', () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    assert.equal(init.code, 0, init.err + init.out);
    const cfg = JSON.parse(fs.readFileSync(path.join(sb.root, '.memev', 'config.json'), 'utf8'));
    assert.equal(cfg.remote?.asked, true, 'remote access was asked');
    assert.equal(cfg.remote?.enabled, false, 'remote access is off');
    const inv = sb.run(['invite']);
    assert.notEqual(inv.code, 0, inv.out);
    assert.match(inv.out + inv.err, /memev cloud on/);
    assert.doesNotMatch(inv.out, /^code: /m);
    assert.doesNotMatch(inv.out, /127\.0\.0\.1/);
  } finally { sb.stop(); }
});

test('REV-020 AC02: with the link on, the invite carries the tunnel address', async () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--no-connect']);
    assert.equal(init.code, 0, init.err + init.out);
    fs.writeFileSync(path.join(sb.root, '.memev', 'tunnel.json'), JSON.stringify({ enabled: true, provider: 'tailscale', url: 'https://rev020.example.com', stable: true, state: 'up' }), { mode: 0o600 });
    // a licence that allows more computers, so the seat policy lets the code through
    const lic = { state: 'valid', tier: 'personal', seats: 3, exp: '2027-01-01' };
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    let rc;
    try {
      rc = await command(null, null, {}, { root: sb.root, env: sb.env, license: lic });
    } finally {
      console.log = origLog;
    }
    const inv = { code: rc, out: logs.join('\n') };
    assert.equal(inv.code, 0, inv.out);
    const code = (inv.out.match(/^code: (\S+)$/m) || [])[1];
    assert.ok(code, inv.out);
    assert.match(inv.out, new RegExp(`^link: https://rev020\\.example\\.com/i/${code}$`, 'm'));
    assert.doesNotMatch(inv.out, /127\.0\.0\.1/);
  } finally { sb.stop(); }
});

test('REV-020 AC03: memev invite --local mints the loopback address for a computer that shares this machine and says so', async () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--no-connect']);
    assert.equal(init.code, 0, init.err + init.out);
    // a licence that allows more computers, so the seat policy lets the code through
    const lic = { state: 'valid', tier: 'personal', seats: 3, exp: '2027-01-01' };
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    let rc;
    try {
      rc = await command(null, null, { local: true }, { root: sb.root, env: sb.env, license: lic });
    } finally {
      console.log = origLog;
    }
    const inv = { code: rc, out: logs.join('\n') };
    assert.equal(inv.code, 0, inv.out);
    const code = (inv.out.match(/^code: (\S+)$/m) || [])[1];
    assert.ok(code, inv.out);
    assert.match(inv.out, new RegExp(`^link: http://127\\.0\\.0\\.1:${sb.port}/i/${code}$`, 'm'));
    assert.match(inv.out, /loopback/);
  } finally { sb.stop(); }
});

test('REV-020: the help for invite names --local and memev cloud on', () => {
  const sb = sandbox();
  try {
    const h = sb.run(['invite', '--help']);
    assert.equal(h.code, 0, h.err + h.out);
    assert.match(h.out, /\[--local\]/);
    assert.match(h.out, /memev cloud on/);
  } finally { sb.stop(); }
});
