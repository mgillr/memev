// On a vault that cannot add a computer, memev invite says so first, in the tier-aware copy,
// and offers the upgrade or the trial; with no trial left it prints no code at all.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
import { command } from '../src/cli/invite.mjs';

after(() => cleanup());

test('MEM-025 AC01: On Free with no trial available, memev invite prints the plan line and the upgrade command and no invite code', () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    assert.equal(init.code, 0, init.err + init.out);
    // A fresh Free vault has no licence and no trial started, so no trial is available to offer.
    // --local keeps the address rules quiet, so only the plan gate can stop the mint.
    const inv = sb.run(['invite', '--local']);
    assert.equal(inv.code, 1, inv.out + inv.err);
    assert.match(inv.out, /Personal covers this computer/);
    assert.match(inv.out, /memev upgrade/);
    assert.match(inv.out, /docs\/GITHUB\.md/);
    assert.doesNotMatch(inv.out, /^code: /m);
  } finally { sb.stop(); }
});

test('MEM-025 AC02: With a licence that allows more computers, memev invite prints the code and no plan line', async () => {
  const sb = sandbox();
  try {
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    assert.equal(init.code, 0, init.err + init.out);
    const lic = { state: 'valid', tier: 'personal', seats: 3, exp: '2027-01-01' };
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    let code;
    try {
      code = await command(null, null, { ttl: '600', local: true }, { root: sb.root, env: sb.env, license: lic });
    } finally {
      console.log = origLog;
    }
    assert.equal(code, 0);
    const out = logs.join('\n');
    assert.match(out, /^code: /m);
    assert.doesNotMatch(out, /Personal covers this computer/);
  } finally { sb.stop(); }
});
