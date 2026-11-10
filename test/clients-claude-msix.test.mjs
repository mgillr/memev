// SR-1.36 T2: the Claude desktop app installed from the Microsoft Store (MSIX) reads a virtualised copy of its config inside
// its package folder, so that is the file connect changes; without the package the usual %APPDATA%\Claude file is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from './helpers/tmp.mjs';
import { connect, disconnect } from '../src/cli/clients.mjs';

const LAUNCHER = '/x/memev';
function win() {
  const home = tmpdir('msix-home-');
  const env = { HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'), MEMEV_CONFIG_DIR: path.join(home, '.config', 'memev'), XDG_CONFIG_HOME: path.join(home, '.config') };
  const pkg = path.join(env.LOCALAPPDATA, 'Packages', 'Claude_pzs8sxrjxfjjc');
  const msixFile = path.join(pkg, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json');
  const usual = path.join(env.APPDATA, 'Claude', 'claude_desktop_config.json');
  return { home, env, pkg, msixFile, usual };
}
const plant = (f, obj) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `${JSON.stringify(obj, null, 2)}\n`); return fs.readFileSync(f); };

test('T2-c01: with the MSIX package and a config holding preferences, connect adds mcpServers.memev there and keeps preferences', () => {
  const w = win();
  plant(w.msixFile, { preferences: { sidebarMode: 'chat' } });
  const r = connect('claude-desktop', { env: w.env, launcher: LAUNCHER, platform: 'win32' });
  assert.equal(r.status, 'added');
  assert.deepEqual(r.files, [w.msixFile]);
  const j = JSON.parse(fs.readFileSync(w.msixFile, 'utf8'));
  assert.deepEqual(j.preferences, { sidebarMode: 'chat' });
  assert.deepEqual(j.mcpServers.memev.args.slice(-3), ['mcp', '--client', 'claude-desktop']);
});

test('T2-c02: in the same case %APPDATA%\\Claude\\claude_desktop_config.json is not created or changed', () => {
  const w = win();
  plant(w.msixFile, { preferences: { sidebarMode: 'chat' } });
  connect('claude-desktop', { env: w.env, launcher: LAUNCHER, platform: 'win32' });
  assert.ok(fs.readFileSync(w.msixFile, 'utf8').includes('"memev"'), 'the entry went into the package copy');
  assert.equal(fs.existsSync(w.usual), false, 'not created');
  const w2 = win();
  plant(w2.msixFile, {}); const before = plant(w2.usual, { theirs: 1 });
  connect('claude-desktop', { env: w2.env, launcher: LAUNCHER, platform: 'win32' });
  assert.ok(fs.readFileSync(w2.usual).equals(before), 'not changed');
});

test('T2-c03: with the package present but LocalCache\\Roaming\\Claude missing, connect creates it and writes the file', () => {
  const w = win();
  fs.mkdirSync(w.pkg, { recursive: true });
  const r = connect('claude-desktop', { env: w.env, launcher: LAUNCHER, platform: 'win32' });
  assert.equal(r.status, 'added');
  assert.ok(fs.existsSync(w.msixFile), 'the folder and file were made');
  assert.ok(JSON.parse(fs.readFileSync(w.msixFile, 'utf8')).mcpServers.memev);
});

test('T2-c04: with no MSIX package, connect writes %APPDATA%\\Claude as before', () => {
  const w = win();
  fs.mkdirSync(path.join(w.env.LOCALAPPDATA, 'Packages', 'SomethingElse_1'), { recursive: true });
  const r = connect('claude-desktop', { env: w.env, launcher: LAUNCHER, platform: 'win32' });
  assert.deepEqual(r.files, [w.usual]);
  assert.ok(fs.existsSync(w.usual));
  assert.ok(JSON.parse(fs.readFileSync(w.usual, 'utf8')).mcpServers.memev);
  assert.equal(fs.existsSync(w.msixFile), false);
  // and on another platform the package folder means nothing
  const w2 = win(); fs.mkdirSync(w2.pkg, { recursive: true });
  const r2 = connect('claude-desktop', { env: w2.env, launcher: LAUNCHER, platform: 'linux' });
  assert.ok(!r2.files[0].includes('Packages'));
});

test('T2-c05: disconnect after an MSIX connect leaves the file equal to its bytes before connect', () => {
  const w = win();
  const before = plant(w.msixFile, { preferences: { sidebarMode: 'chat' } });
  connect('claude-desktop', { env: w.env, launcher: LAUNCHER, platform: 'win32' });
  assert.ok(!fs.readFileSync(w.msixFile).equals(before));
  disconnect('claude-desktop', { env: w.env, platform: 'win32' });
  assert.ok(fs.readFileSync(w.msixFile).equals(before));
  // once the person edited it since, only Memev's entry goes and the edit stays
  connect('claude-desktop', { env: w.env, launcher: LAUNCHER, platform: 'win32' });
  const j = JSON.parse(fs.readFileSync(w.msixFile, 'utf8')); j.preferences.theme = 'dark'; fs.writeFileSync(w.msixFile, JSON.stringify(j));
  disconnect('claude-desktop', { env: w.env, platform: 'win32' });
  const after = JSON.parse(fs.readFileSync(w.msixFile, 'utf8'));
  assert.equal(after.mcpServers?.memev, undefined); assert.equal(after.preferences.theme, 'dark');
});
