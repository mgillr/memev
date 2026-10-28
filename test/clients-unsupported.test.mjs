// Apps Memev detects but does not support yet are listed as found, not supported yet, and their files are never changed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';
import { detect, connectAll } from '../src/cli/clients.mjs';

after(() => cleanup());

const NAMES = { cline: 'Cline', roo: 'Roo', continue: 'Continue', kiro: 'Kiro', 'jetbrains-ai': 'JetBrains AI', amp: 'Amp', goose: 'Goose' };

// The directory each app's docs name, on the platform this run is on. The tests plant exactly these,
// so a lookup that points anywhere else fails the run.
function appDirs(sb) {
  const home = sb.home;
  const win = process.platform === 'win32';
  const xdg = sb.env.XDG_CONFIG_HOME || path.join(home, '.config');
  const appData = process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support')
    : win ? (sb.env.APPDATA || path.join(home, 'AppData', 'Roaming'))
    : xdg;
  return {
    cline: path.join(home, '.cline'),
    roo: path.join(home, '.roo'),
    continue: path.join(home, '.continue'),
    kiro: path.join(home, '.kiro'),
    'jetbrains-ai': path.join(appData, 'JetBrains'),
    amp: win ? path.join(home, '.config', 'amp') : path.join(xdg, 'amp'),
    goose: win ? path.join(sb.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Block', 'goose') : path.join(xdg, 'goose'),
  };
}

test('MEM-046 AC01: with fake config dirs for Cline, Continue and Goose, the checklist lists each as found but not supported yet', () => {
  const sb = sandbox();
  try {
    const dirs = appDirs(sb);
    for (const id of ['cline', 'continue', 'goose']) fs.mkdirSync(dirs[id], { recursive: true });
    const r = sb.run(['init', '--port', String(sb.port), '--local-only']);
    assert.equal(r.code, 0, r.out + r.err);
    for (const id of ['cline', 'continue', 'goose']) {
      assert.match(r.out, new RegExp(`${NAMES[id]}: found, not supported yet`), `${NAMES[id]} is listed as found, not supported yet\n${r.out}`);
    }
    assert.match(r.out, /docs\/CLIENTS\.md/, 'the line points to docs/CLIENTS.md');
    // the found-but-unsupported apps are not treated as connected or as steps that need the user
    assert.equal(r.out.includes('Cline: MCP'), false, r.out);
    assert.equal(r.out.includes('memev connect cline'), false, r.out);
  } finally { sb.stop(); }
});

// Hashes every file in a folder tree (relative path plus bytes), so a new file written beside the
// planted ones, or a changed or removed one, changes the hash.
function hashTree(dir) {
  const h = crypto.createHash('sha256');
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { h.update(path.relative(dir, p) + '\0'); h.update(fs.readFileSync(p)); }
    }
  };
  walk(dir);
  return h.digest('hex');
}

test('MEM-046 AC02: no file in an unsupported app folder is modified, added or removed', () => {
  const sb = sandbox();
  try {
    const dirs = appDirs(sb);
    for (const id of Object.keys(dirs)) {
      fs.mkdirSync(path.join(dirs[id], 'sub'), { recursive: true });
      fs.writeFileSync(path.join(dirs[id], 'settings.json'), JSON.stringify({ app: id, theme: 'dark', key: 'value' }, null, 2));
      fs.writeFileSync(path.join(dirs[id], 'notes.txt'), `notes for ${id}`);
      fs.writeFileSync(path.join(dirs[id], 'sub', 'inner.json'), '{"nested":true}');
    }
    const before = Object.fromEntries(Object.entries(dirs).map(([k, d]) => [k, hashTree(d)]));
    const r = sb.run(['init', '--port', String(sb.port), '--local-only']);
    assert.equal(r.code, 0, r.out + r.err);
    connectAll({ env: sb.env, launcher: '/x/memev' });
    const after = Object.fromEntries(Object.entries(dirs).map(([k, d]) => [k, hashTree(d)]));
    assert.deepEqual(after, before, 'every file and subfolder of each unsupported app is byte for byte the same');
    const st = fs.existsSync(path.join(sb.env.MEMEV_CONFIG_DIR, 'clients-state.json'))
      ? JSON.parse(fs.readFileSync(path.join(sb.env.MEMEV_CONFIG_DIR, 'clients-state.json'), 'utf8'))
      : { connected: {}, files: {} };
    for (const id of Object.keys(dirs)) {
      assert.equal(st.connected[id], undefined, `${id} is not connected`);
      assert.equal(Object.keys(st.files).some((f) => f.startsWith(dirs[id])), false, `${id} has no file under Memev's management`);
    }
  } finally { sb.stop(); }
});

test('planting each documented directory finds the app as found, not supported yet', () => {
  const sb = sandbox();
  try {
    const dirs = appDirs(sb);
    for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
    const d = detect(sb.env, '/x/memev');
    for (const [id, dir] of Object.entries(dirs)) {
      const c = d.find((x) => x.id === id);
      assert.ok(c, `${id} is in the detected list`);
      assert.equal(c.found, true, `${id} is found at ${dir}`);
      assert.equal(c.supported, false, `${id} is not supported yet`);
    }
  } finally { sb.stop(); }
});

test('detect marks a found unsupported app with supported false, and connectAll leaves it out', () => {
  const sb = sandbox();
  try {
    const dirs = appDirs(sb);
    fs.mkdirSync(dirs.cline, { recursive: true });
    fs.mkdirSync(path.join(sb.home, '.codex'), { recursive: true });
    const d = detect(sb.env, '/x/memev');
    const cline = d.find((c) => c.id === 'cline');
    assert.equal(cline.found, true);
    assert.equal(cline.supported, false);
    const codex = d.find((c) => c.id === 'codex');
    assert.equal(codex.found, true);
    assert.equal(codex.supported, true);
    const res = connectAll({ env: sb.env, launcher: '/x/memev' });
    assert.deepEqual(res.map((x) => x.id), ['codex'], 'connectAll connects the supported app and leaves the unsupported one alone');
  } finally { sb.stop(); }
});

test('memev clients lists a found unsupported app as found, not supported yet', () => {
  const sb = sandbox();
  try {
    const dirs = appDirs(sb);
    fs.mkdirSync(dirs.goose, { recursive: true });
    const i = sb.run(['init', '--port', String(sb.port), '--local-only']);
    assert.equal(i.code, 0, i.out + i.err);
    const c = sb.run(['clients']);
    assert.equal(c.code, 0, c.out + c.err);
    assert.match(c.out, /Goose\s+found, not supported yet/, c.out);
  } finally { sb.stop(); }
});

test('memev connect for a found unsupported app says found, not supported yet and changes nothing', () => {
  const sb = sandbox();
  try {
    const dirs = appDirs(sb);
    const f = path.join(dirs.amp, 'config.json');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, '{"theme":"dark"}');
    const before = fs.readFileSync(f);
    const i = sb.run(['init', '--port', String(sb.port), '--local-only']);
    assert.equal(i.code, 0, i.out + i.err);
    const c = sb.run(['connect', 'amp']);
    assert.equal(c.code, 0, c.out + c.err);
    assert.match(c.out, /Amp: found, not supported yet/, c.out);
    assert.ok(fs.readFileSync(f).equals(before), 'the amp config is unchanged');
  } finally { sb.stop(); }
});
