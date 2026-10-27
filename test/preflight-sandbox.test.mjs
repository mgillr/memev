// Inside a Codex sandbox init cannot write the vault or the apps' settings. It stops before anything is written
// and prints the one command to run in the person's own terminal. Without a sandbox marker init runs as before.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';
import { gate, sandboxMarker, sandboxStop, initCommand } from '../src/cli/preflight.mjs';

after(cleanup);

const run = (sb, args, marker) => sb.run(args, { extraEnv: marker });
const untouched = (sb) => { assert.equal(fs.existsSync(sb.root), false, 'no vault'); assert.equal(fs.existsSync(sb.env.MEMEV_CONFIG_DIR), false, 'no config folder'); assert.deepEqual(fs.readdirSync(sb.home), [], 'nothing in the home folder'); };

test('MEM-050 AC01: With CODEX_SANDBOX set, init exits non-zero, writes no vault, and prints a memev init command', () => {
  const sb = sandbox();
  const r = run(sb, ['init', '--port', String(sb.port)], { CODEX_SANDBOX: 'seatbelt' });
  assert.notEqual(r.code, 0, r.out + r.err);
  const text = r.out + r.err;
  assert.match(text, /CODEX_SANDBOX=seatbelt/);
  assert.match(text, /memev init --port \d+/, 'the command to run, with the option that was given');
  assert.match(text, /own terminal/);
  assert.match(text, /approve/);
  assert.doesNotMatch(text, /Cannot read properties|TypeError/);
  untouched(sb);
  // the same for a sandbox with no network, and for --join and a given root
  for (const [env, args] of [[{ CODEX_SANDBOX_NETWORK_DISABLED: '1' }, ['init']], [{ CODEX_SANDBOX: 'seatbelt' }, ['init', '--join', 'abc']], [{ CODEX_SANDBOX: 'seatbelt' }, ['init', '--root', path.join(sb.home, 'v')]]]) {
    const x = run(sb, args, env);
    assert.notEqual(x.code, 0, `${JSON.stringify(env)} ${args}`);
    assert.match(x.out + x.err, /memev init/);
    untouched(sb);
  }
});

test('MEM-050 AC01: the marker is read as the sandbox sets it: a value of 0 means no sandbox', () => {
  assert.equal(sandboxMarker({ CODEX_SANDBOX: 'seatbelt' }), 'CODEX_SANDBOX=seatbelt');
  assert.equal(sandboxMarker({ CODEX_SANDBOX_NETWORK_DISABLED: '1' }), 'CODEX_SANDBOX_NETWORK_DISABLED=1');
  assert.equal(sandboxMarker({ CODEX_SANDBOX_NETWORK_DISABLED: '0' }), null);
  assert.equal(sandboxMarker({ CODEX_SANDBOX: '' }), null);
  assert.equal(sandboxMarker({}), null);
  assert.equal(sandboxMarker({ CODEX_MANAGED_BY_NPM: '1' }), null, 'an npm-managed install is not a sandbox');
  assert.equal(initCommand({ port: '7790', 'local-only': true, root: '/a b' }), 'memev init --port 7790 --local-only', 'only plain values are copied into the command');
  assert.match(sandboxStop({ env: { CODEX_SANDBOX: 'seatbelt' } }), /^This session runs inside a sandbox/);
});

test('MEM-050 AC02: Without a sandbox marker init proceeds normally', async () => {
  const sb = sandbox();
  assert.equal(await gate({ root: sb.root, env: sb.env, flags: { port: sb.port } }), true, 'the gate lets it through');
  const r = run(sb, ['init', '--port', String(sb.port), '--no-connect'], { CODEX_SANDBOX_NETWORK_DISABLED: '0' });
  assert.equal(r.code, 0, r.out + r.err);
  assert.ok(fs.existsSync(path.join(sb.root, '.memev', 'config.json')), 'the vault is created');
  assert.doesNotMatch(r.out + r.err, /sandbox/);
  sb.stop();
});
