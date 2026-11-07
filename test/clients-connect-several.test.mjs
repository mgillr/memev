// memev connect <app> <app> ...: the setup screen sends the apps the person ticked, and exactly those are connected.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { connectSelected, disconnect, detect } from '../src/cli/clients.mjs';
import { checkAllowlist } from '../src/cli/setup-remote.mjs';
import { tmpdir, cleanup } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
after(() => cleanup());

function fixtureHome() {
  const home = tmpdir('home-');
  const env = { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), MEMEV_CONFIG_DIR: path.join(home, '.config', 'memev') };
  // three apps installed: Codex, Cursor and Gemini CLI
  for (const d of ['.codex', '.cursor', '.gemini']) fs.mkdirSync(path.join(home, d), { recursive: true });
  return { home, env };
}
const connectedIds = (env) => detect(env).filter((c) => c.connected).map((c) => c.id).sort();

test('connectSelected connects exactly the named apps and leaves the other found apps alone', () => {
  const { home, env } = fixtureHome();
  const res = connectSelected(['codex', 'cursor'], { env, launcher: '/x/memev', platform: 'linux' });
  assert.deepEqual(res.map((r) => `${r.id}:${r.status}`), ['codex:added', 'cursor:added']);
  assert.deepEqual(connectedIds(env), ['codex', 'cursor']);
  assert.equal(fs.existsSync(path.join(home, '.gemini', 'settings.json')), false, 'Gemini CLI was found but not named, so its files are untouched');
  const again = connectSelected(['codex', 'cursor', 'codex'], { env, launcher: '/x/memev', platform: 'linux' });
  assert.deepEqual(again.map((r) => `${r.id}:${r.status}`), ['codex:already', 'cursor:already'], 'a repeated name counts once and a second run changes nothing');
});

test('connectSelected checks every name first: one unknown name connects nothing', () => {
  const { env } = fixtureHome();
  assert.throws(() => connectSelected(['codex', 'no-such-app'], { env, launcher: '/x/memev', platform: 'linux' }), /unknown app: no-such-app/);
  assert.deepEqual(connectedIds(env), [], 'nothing was connected');
  assert.throws(() => connectSelected(['all', 'codex'], { env, launcher: '/x/memev', platform: 'linux' }), /use it alone/);
  assert.throws(() => connectSelected([], { env, launcher: '/x/memev', platform: 'linux' }), /at least one app/);
});

test('connectSelected connects a named app the person declined before, and reports an unsupported one without changing it', () => {
  const { home, env } = fixtureHome();
  connectSelected(['codex'], { env, launcher: '/x/memev', platform: 'linux' });
  disconnect('codex', { env });
  assert.equal(detect(env).find((c) => c.id === 'codex').declined, true);
  fs.mkdirSync(path.join(home, '.cline'), { recursive: true });
  const unsupported = detect(env).find((c) => c.supported === false && c.found);
  const ids = ['codex', ...(unsupported ? [unsupported.id] : [])];
  const res = connectSelected(ids, { env, launcher: '/x/memev', platform: 'linux' });
  assert.equal(res[0].status, 'added', 'naming the app is the yes');
  assert.equal(detect(env).find((c) => c.id === 'codex').declined, false);
  if (unsupported) assert.equal(res[1].status, 'unsupported');
});

test('memev connect with several apps connects exactly those, and all stays the every-app form', () => {
  const sb = sandbox();
  try {
    for (const d of ['.codex', '.cursor', '.gemini']) fs.mkdirSync(path.join(sb.home, d), { recursive: true });
    const r = sb.run(['connect', 'codex', 'gemini-cli']);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /Codex CLI: connected/);
    assert.match(r.out, /Gemini CLI: connected/);
    assert.equal(r.out.includes('Cursor'), false, r.out);
    assert.equal(fs.existsSync(path.join(sb.home, '.cursor', 'mcp.json')), false, 'Cursor was not named');
    const bad = sb.run(['connect', 'codex', 'nope']);
    assert.notEqual(bad.code, 0, 'an unknown name fails the command');
    assert.match(bad.out + bad.err, /unknown app: nope/);
    const mixed = sb.run(['connect', 'all', 'codex']);
    assert.notEqual(mixed.code, 0, 'all cannot be mixed with names');
    const all = sb.run(['connect']);
    assert.equal(all.code, 0, all.out + all.err);
    assert.ok(fs.existsSync(path.join(sb.home, '.cursor', 'mcp.json')), 'connect with no app still connects every found app');
  } finally { sb.stop(); }
});

test('the remote setup allowlist takes the ticked apps, and refuses all, unknown and unsupported names among them', () => {
  const root = tmpdir('root-');
  const apps = detect();
  const found = apps.filter((a) => a.found && a.supported !== false).map((a) => a.id);
  const notFound = apps.find((a) => !a.found && a.supported !== false);
  if (found.length >= 2) assert.ok(checkAllowlist(['connect', ...found.slice(0, 2)], root).ok);
  if (found.length) {
    assert.equal(checkAllowlist(['connect', found[0], 'all'], root).ok, false);
    assert.equal(checkAllowlist(['connect', found[0], 'no-such-app'], root).ok, false);
    if (notFound) assert.equal(checkAllowlist(['connect', found[0], notFound.id], root).ok, false);
  }
  assert.equal(checkAllowlist(['connect', 'all'], root).ok, false);
  assert.equal(checkAllowlist(['connect', 'no-such-app', 'other'], root).ok, false);
});
