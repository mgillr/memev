// SR-1.36 T4: Grok Bot, xAI's desktop app, is found on Windows and macOS from names only, kept apart from Grok Build, and
// shown as one step by hand: Memev never writes or reads anything of Grok Bot's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from './helpers/tmp.mjs';
import { connectAll, detect } from '../src/cli/clients.mjs';

const load = async () => { const m = await import('../src/cli/discover.mjs').catch(() => null); assert.ok(m, 'src/cli/discover.mjs exists'); return m; };
const row = (list, id) => { const r = list.find((a) => a.id === id); assert.ok(r, `${id} is listed`); return r; };
const only = (paths, P) => ({ registry: () => ({ entries: [] }), list: () => [], stat: (p) => (paths.includes(p) ? { dir: true, file: false, real: p } : null), P });

test('T4-c01: the Windows Uninstall entry alone with a blank InstallLocation finds Grok Bot, and each macOS place alone does too', async () => {
  const { discover } = await load();
  const W = { HOME: 'C:\\U', USERPROFILE: 'C:\\U', APPDATA: 'C:\\U\\AppData\\Roaming', LOCALAPPDATA: 'C:\\U\\AppData\\Local', PATH: '' };
  const reg = { registry: (h) => ({ entries: h.startsWith('HKCU') ? [{ DisplayName: 'Grok Bot', InstallLocation: '' }] : [] }), list: () => [], stat: () => null };
  const w = row(discover(W, 'win32', reg).apps, 'grok-bot');
  assert.equal(w.found, true); assert.equal(w.evidence, 'registry');
  const mac = { HOME: '/Users/user', PATH: '', MEMEV_SYSTEM_APPS: '/Applications' };
  for (const p of ['/Applications/Grok Bot.app', '/Users/user/Library/Application Support/Grok Bot', '/Users/user/Applications/Grok Bot.app']) {
    const a = row(discover(mac, 'darwin', only([p])).apps, 'grok-bot');
    assert.equal(a.found, true, p); assert.equal(a.install_path, p);
    assert.equal(row(discover(mac, 'darwin', only([p])).apps, 'grok-build').found, false, 'Grok Build is another app');
  }
});

test('T4-c02: ~/.grok alone makes grok-build found and grok-bot not; ~/.grokbot alone the reverse', async () => {
  const { discover } = await load();
  for (const [dir, yes, no] of [['.grok', 'grok-build', 'grok-bot'], ['.grokbot', 'grok-bot', 'grok-build']]) {
    const h = tmpdir('grokbot-'); fs.mkdirSync(path.join(h, dir));
    const env = { HOME: h, XDG_CONFIG_HOME: path.join(h, '.config'), PATH: '' };
    const old = detect(env, 'memev', 'linux');
    assert.equal(row(old, yes).found, true, `${dir}: ${yes}`); assert.equal(row(old, no).found, false, `${dir}: not ${no}`);
    const now = discover(env, 'linux', only([], path.posix)).apps;
    assert.equal(row(now, yes).found, true); assert.equal(row(now, no).found, false);
  }
  // the grok command on PATH is Grok Build's
  const h = tmpdir('grokbot-path-'); fs.mkdirSync(path.join(h, 'bin')); fs.writeFileSync(path.join(h, 'bin', 'grok'), '');
  const now = discover({ HOME: h, PATH: path.join(h, 'bin') }, 'linux').apps;
  assert.equal(row(now, 'grok-build').found, true); assert.equal(row(now, 'grok-bot').found, false);
});

test('T4-c03: grok-bot is one-step with a step to copy, and connect all neither writes nor reads any file under its folders', async (t) => {
  const { discover } = await load();
  const h = tmpdir('grokbot-all-');
  const dirs = [path.join(h, '.grokbot'), path.join(h, 'Applications', 'Grok Bot.app'), path.join(h, 'Library', 'Application Support', 'Grok Bot')];
  for (const d of dirs) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'settings.json'), '{"token":"x"}'); }
  fs.mkdirSync(path.join(h, '.codex'));
  const env = { HOME: h, XDG_CONFIG_HOME: path.join(h, '.config'), MEMEV_CONFIG_DIR: path.join(h, '.config', 'memev'), PATH: '', MEMEV_PORT: '7799' };
  const a = row(discover(env, 'linux', only([], path.posix)).apps, 'grok-bot');
  assert.equal(a.automation, 'one-step'); assert.ok(a.step && a.step.length > 20); assert.match(a.step, /http:\/\/127\.0\.0\.1:7799\/mcp/);
  const touched = [];
  for (const n of ['readFileSync', 'writeFileSync', 'openSync', 'readFile', 'writeFile', 'open', 'createReadStream', 'createWriteStream', 'renameSync', 'rmSync', 'unlinkSync', 'copyFileSync', 'appendFileSync']) {
    const orig = fs[n];
    t.mock.method(fs, n, function (p, ...rest) { touched.push(String(p)); return orig.call(fs, p, ...rest); });
  }
  syncBuiltinESMExports();
  let res;
  try { res = connectAll({ env, launcher: '/x/memev', platform: 'darwin' }); } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.ok(res.some((r) => r.id === 'codex'), 'another app was connected in the same run');
  assert.ok(!res.some((r) => r.id === 'grok-bot'), 'grok-bot is not connected');
  const inside = touched.filter((p) => dirs.some((d) => p === d || p.startsWith(d + path.sep)));
  assert.deepEqual(inside, [], 'nothing under Grok Bot\'s folders was opened, read or written');
  for (const d of dirs) assert.equal(fs.readFileSync(path.join(d, 'settings.json'), 'utf8'), '{"token":"x"}');
  assert.equal(row(detect(env, 'memev', 'darwin'), 'grok-bot').found, true, 'found from those folders by name');
});
