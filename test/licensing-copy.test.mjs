// The second-computer moment on Free gets tier-aware, neutral copy: it points at the plans
// instead of telling the user to remove a computer that cannot be removed, and it stays out
// of the resume card and the AI context.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';
import { seatPolicy, TIERS } from '../src/engine/entitlements.mjs';
import { deviceKeygen } from '../src/engine/devices.mjs';
after(cleanup);

const freeCopy = () => `Personal covers this computer. Adding more computers is part of Personal with more computers (up to ${TIERS.personal.computers} computers). Run memev upgrade to see plans.`;

test('MEM-062 AC01: on Free, enrolling a second computer prints the tier-aware text with the count from the entitlement table and never suggests memev devices remove', () => {
  // the policy the vault uses to refuse the second computer carries the tier-aware text
  const p = seatPolicy({ license: null, devices: [] });
  assert.equal(p.can_enroll, false);
  assert.equal(p.reason, freeCopy());
  assert.doesNotMatch(p.reason, /devices remove/);
  // and the CLI prints it, with the count read from the entitlement table
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    assert.equal(init.code, 0, init.err);
    const e = sb.run(['devices', 'enroll', '--kind', 'remote-computer', '--label', 'second', '--pubkey', deviceKeygen().publicKey]);
    assert.equal(e.code, 1);
    const out = e.out + e.err;
    assert.ok(out.includes(freeCopy()), `expected the tier-aware text, got: ${out}`);
    assert.ok(out.includes(`up to ${TIERS.personal.computers} computers`), 'the count comes from the entitlement table');
    assert.doesNotMatch(out, /devices remove/);
  } finally { sb.stop(); }
});

test('MEM-062 AC02: no plan or upgrade text appears in the resume card or hook output', () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    assert.equal(init.code, 0, init.err);
    // a second computer is refused on Free, so the tier-aware text exists at that moment
    const e = sb.run(['devices', 'enroll', '--kind', 'remote-computer', '--label', 'second', '--pubkey', deviceKeygen().publicKey]);
    assert.equal(e.code, 1);
    // the resume card the session-start hook brings to the AI carries none of it
    const h = sb.hook('session-start', { session_id: 'copy-0001', cwd: sb.home, source: 'startup' });
    assert.equal(h.code, 0, h.err);
    const ctx = h.out ? JSON.parse(h.out).hookSpecificOutput?.additionalContext || '' : '';
    assert.ok(ctx.length > 0, 'the hook brings a resume card');
    for (const frag of ['Free covers this computer', 'Adding more computers is part of Personal', 'Run memev upgrade', 'start a trial']) {
      assert.doesNotMatch(ctx, new RegExp(frag, 'i'), `the AI context must not carry: ${frag}`);
    }
  } finally { sb.stop(); }
});
