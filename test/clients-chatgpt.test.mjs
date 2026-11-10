// SR-1.36 T3: the ChatGPT desktop app shares the Codex CLI's ~/.codex/config.toml. Configuring it writes the one shared
// [mcp_servers.memev] table, and both apps stay configured and unverified: a write alone is never reported as connected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from './helpers/tmp.mjs';
import { clientDefs, connect, connectSelected, disconnect } from '../src/cli/clients.mjs';

const LAUNCHER = '/x/memev';
function home() {
  const h = tmpdir('chatgpt-home-');
  const env = { HOME: h, XDG_CONFIG_HOME: path.join(h, '.config'), MEMEV_CONFIG_DIR: path.join(h, '.config', 'memev') };
  return { h, env, toml: path.join(h, '.codex', 'config.toml') };
}
const tables = (f) => (fs.readFileSync(f, 'utf8').match(/^\[mcp_servers\.memev\]/gm) || []).length;
const known = () => assert.ok(clientDefs({ HOME: '/x' }, 'memev', 'linux').some((d) => d.id === 'chatgpt-desktop'), 'chatgpt-desktop is an app Memev knows');

test('T3-c01: connect chatgpt-desktop alone writes exactly one [mcp_servers.memev] table in ~/.codex/config.toml', () => {
  known();
  const { env, toml } = home();
  fs.mkdirSync(path.dirname(toml), { recursive: true }); fs.writeFileSync(toml, 'model = "o3"\n');
  const r = connect('chatgpt-desktop', { env, launcher: LAUNCHER, platform: 'linux' });
  assert.equal(tables(toml), 1);
  assert.match(fs.readFileSync(toml, 'utf8'), /^model = "o3"$/m, 'the person\'s settings stay');
  assert.equal(r.status, 'configured'); assert.equal(r.verified, false);
  assert.equal(connect('chatgpt-desktop', { env, launcher: LAUNCHER, platform: 'linux' }).status, 'configured', 'a second connect is still only configured');
  assert.equal(tables(toml), 1);
});

test('T3-c02: connect codex chatgpt-desktop writes the table once and reports both configured and unverified, never connected', () => {
  known();
  const { env, toml } = home();
  fs.mkdirSync(path.dirname(toml), { recursive: true });
  const res = connectSelected(['codex', 'chatgpt-desktop'], { env, launcher: LAUNCHER, platform: 'linux' });
  assert.equal(tables(toml), 1);
  assert.deepEqual(res.map((r) => [r.id, r.status, r.verified]), [['codex', 'configured', false], ['chatgpt-desktop', 'configured', false]]);
  // the other order gives the same
  const b = home(); fs.mkdirSync(path.dirname(b.toml), { recursive: true });
  const res2 = connectSelected(['chatgpt-desktop', 'codex'], { env: b.env, launcher: LAUNCHER, platform: 'linux' });
  assert.deepEqual(res2.map((r) => [r.id, r.status]), [['chatgpt-desktop', 'configured'], ['codex', 'configured']]);
  assert.equal(tables(b.toml), 1);
  // Codex on its own keeps its usual answer
  const c = home(); fs.mkdirSync(path.dirname(c.toml), { recursive: true });
  assert.equal(connectSelected(['codex'], { env: c.env, launcher: LAUNCHER, platform: 'linux' })[0].status, 'added');
  // a failed app in the same run is not marked configured
  const d = home(); fs.mkdirSync(path.dirname(d.toml), { recursive: true }); fs.writeFileSync(d.toml, '[broken\n');
  const res4 = connectSelected(['codex', 'chatgpt-desktop'], { env: d.env, launcher: LAUNCHER, platform: 'linux' });
  assert.deepEqual(res4.map((r) => r.status), ['needs-manual', 'needs-manual']);
});

test('T3-c03: disconnect chatgpt-desktop while codex stays configured leaves the shared table', () => {
  known();
  for (const order of [['codex', 'chatgpt-desktop'], ['chatgpt-desktop', 'codex']]) {
    const { env, toml } = home();
    fs.mkdirSync(path.dirname(toml), { recursive: true }); fs.writeFileSync(toml, 'model = "o3"\n');
    for (const id of order) connect(id, { env, launcher: LAUNCHER, platform: 'linux' });
    const r = disconnect('chatgpt-desktop', { env, platform: 'linux' });
    assert.equal(tables(toml), 1, `the table stays for codex (${order})`);
    if (order[0] === 'chatgpt-desktop') assert.match(r.results[0].action, /kept for codex/);
    assert.equal(connect('codex', { env, launcher: LAUNCHER, platform: 'linux' }).status, 'already', 'codex is no longer sharing, so it is not held back');
    disconnect('codex', { env, platform: 'linux' });
    assert.equal(fs.readFileSync(toml, 'utf8'), 'model = "o3"\n', 'with both gone the person\'s file comes back');
  }
});
