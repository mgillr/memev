// SR-1.36 T1: memev discover finds every supported AI app on Windows, macOS and Linux from names only, and never runs or
// opens anything but the system reg.exe on Windows. Each subtest is named after its criterion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { PKG, tmpdir } from './helpers/tmp.mjs';

const load = async () => {
  const m = await import('../src/cli/discover.mjs').catch(() => null);
  assert.ok(m, 'src/cli/discover.mjs exists');
  assert.equal(typeof m.discover, 'function', 'it exports discover(env, platform, readers)');
  return m;
};
const W = path.win32;
const WHOME = 'C:\\Users\\user';
const WENV = { USERPROFILE: WHOME, HOME: WHOME, APPDATA: `${WHOME}\\AppData\\Roaming`, LOCALAPPDATA: `${WHOME}\\AppData\\Local`, PATH: 'C:\\Tools' };
// Fake readers over a table of paths: 'dir', 'file', or { link: target } for a link. Registry hives return the given entries.
function fake({ paths = {}, hives = {}, timeout = [] } = {}, P = W) {
  const calls = { registry: [] };
  const resolve = (p) => (typeof paths[p] === 'object' ? resolve(paths[p].link) : p); // ('dir'.link is a String method)
  return {
    calls,
    registry: (hive) => { calls.registry.push(hive); return timeout.includes(hive) ? { entries: [], timedOut: true } : { entries: hives[hive] || [] }; },
    list: (dir) => Object.keys(paths).filter((p) => P.dirname(p) === dir).map((p) => P.basename(p)),
    stat: (p) => { const real = resolve(p); const k = paths[real]; return k ? { dir: k === 'dir', file: k === 'file', real } : null; },
  };
}
const app = (res, id) => res.apps.find((a) => a.id === id);
const HKCU = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
const HKLM = 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
const WOW = 'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall';

test('T1-c01: a Grok Bot Uninstall entry with a blank InstallLocation is found at the folder of its DisplayIcon', async () => {
  const { discover } = await load();
  const dir = `${WENV.LOCALAPPDATA}\\Programs\\Grok Bot`;
  const r = fake({ hives: { [HKCU]: [{ DisplayName: 'Grok Bot', DisplayVersion: '1.2.0', InstallLocation: '', DisplayIcon: `"${dir}\\Grok Bot.exe",0` }] } });
  const a = app(discover(WENV, 'win32', r), 'grok-bot');
  assert.equal(a.found, true); assert.equal(a.evidence, 'registry'); assert.equal(a.install_path, dir);
  // InstallLocation, when given, wins over the icon
  const r2 = fake({ hives: { [HKCU]: [{ DisplayName: 'Grok Bot', InstallLocation: 'D:\\Apps\\Grok Bot', DisplayIcon: `${dir}\\Grok Bot.exe` }] } });
  assert.equal(app(discover(WENV, 'win32', r2), 'grok-bot').install_path, 'D:\\Apps\\Grok Bot');
  // with neither, the app's known folder that exists
  const r3 = fake({ paths: { [dir]: 'dir' }, hives: { [HKCU]: [{ DisplayName: 'Grok Bot' }] } });
  assert.equal(app(discover(WENV, 'win32', r3), 'grok-bot').install_path, dir);
  const r4 = fake({ hives: { [HKCU]: [{ DisplayName: 'Grok Bot' }] } });
  assert.equal(app(discover(WENV, 'win32', r4), 'grok-bot').install_path, null);
  // a name that only starts the same is another app
  const r5 = fake({ hives: { [HKCU]: [{ DisplayName: 'Grok Bot Helper' }] } });
  assert.equal(app(discover(WENV, 'win32', r5), 'grok-bot').found, false);
});

test('T1-c02: a Microsoft Copilot entry in HKLM WOW6432Node is found, with automation none', async () => {
  const { discover } = await load();
  const r = fake({ hives: { [WOW]: [{ DisplayName: 'Microsoft Copilot', DisplayVersion: '1.0' }] } });
  const res = discover(WENV, 'win32', r);
  const a = app(res, 'microsoft-copilot');
  assert.equal(a.found, true); assert.equal(a.evidence, 'registry'); assert.equal(a.automation, 'none'); assert.equal(a.step, null);
  assert.deepEqual(r.calls.registry, [HKCU, HKLM, WOW], 'each of the three hives is read once');
  // the HKLM hive counts too
  assert.equal(app(discover(WENV, 'win32', fake({ hives: { [HKLM]: [{ DisplayName: 'Cursor (User)' }] } })), 'cursor').found, true);
});

test('T1-c03: a Claude MSIX package folder alone makes claude-desktop found with evidence msix', async () => {
  const { discover } = await load();
  const pkg = `${WENV.LOCALAPPDATA}\\Packages\\Claude_pzs8sxrjxfjjc`;
  const a = app(discover(WENV, 'win32', fake({ paths: { [pkg]: 'dir' } })), 'claude-desktop');
  assert.equal(a.found, true); assert.equal(a.evidence, 'msix'); assert.equal(a.install_path, pkg);
  assert.equal(a.automation, 'auto');
  // the package folder of another app is not Claude's
  assert.equal(app(discover(WENV, 'win32', fake({ paths: { [`${WENV.LOCALAPPDATA}\\Packages\\ClaudeX`]: 'dir' } })), 'claude-desktop').found, false);
  // a known folder under Local is a find of its own
  const cur = `${WENV.LOCALAPPDATA}\\Programs\\cursor`;
  const c = app(discover(WENV, 'win32', fake({ paths: { [cur]: 'dir' } })), 'cursor');
  assert.equal(c.evidence, 'folder'); assert.equal(c.install_path, cur);
  // and Roaming: Grok Bot's settings folder
  const gb = `${WENV.APPDATA}\\Grok Bot`;
  assert.equal(app(discover(WENV, 'win32', fake({ paths: { [gb]: 'dir' } })), 'grok-bot').install_path, gb);
  // a file of that name is not a folder
  assert.equal(app(discover(WENV, 'win32', fake({ paths: { [cur]: 'file' } })), 'cursor').found, false);
});

test('T1-c04: on darwin /Applications/ChatGPT.app or ~/Applications/ChatGPT.app makes chatgpt-desktop found', async () => {
  const { discover } = await load();
  const P = path.posix; const env = { HOME: '/Users/user', PATH: '' };
  const sys = fake({ paths: { '/Applications/ChatGPT.app': 'dir' } }, P);
  const a = app(discover(env, 'darwin', sys), 'chatgpt-desktop');
  assert.equal(a.found, true); assert.equal(a.evidence, 'app-bundle'); assert.equal(a.install_path, '/Applications/ChatGPT.app');
  const mine = fake({ paths: { '/Users/user/Applications/ChatGPT.app': 'dir' } }, P);
  assert.equal(app(discover(env, 'darwin', mine), 'chatgpt-desktop').install_path, '/Users/user/Applications/ChatGPT.app');
  // the system Applications folder can be moved (tests on a Mac with real apps installed)
  const moved = fake({ paths: { '/S/ChatGPT.app': 'dir' } }, P);
  assert.equal(app(discover({ ...env, MEMEV_SYSTEM_APPS: '/S' }, 'darwin', moved), 'chatgpt-desktop').found, true);
  assert.equal(app(discover(env, 'darwin', moved), 'chatgpt-desktop').found, false);
  // no invented bundle name: only ChatGPT.app counts
  assert.equal(app(discover(env, 'darwin', fake({ paths: { '/Applications/ChatGPT Desktop.app': 'dir' } }, P)), 'chatgpt-desktop').found, false);
  // Grok Bot from Application Support alone
  const sup = '/Users/user/Library/Application Support/Grok Bot';
  const g = app(discover(env, 'darwin', fake({ paths: { [sup]: 'dir' } }, P)), 'grok-bot');
  assert.equal(g.evidence, 'folder'); assert.equal(g.install_path, sup);
  // Application Support is a macOS place: on Linux the same folder finds nothing
  assert.equal(app(discover(env, 'linux', fake({ paths: { [sup]: 'dir' } }, P)), 'grok-bot').found, false);
  // a bundle is a macOS find only
  assert.equal(app(discover(env, 'linux', sys), 'chatgpt-desktop').found, false);
});

test('T1-c05: on linux a .desktop file or a PATH entry named after the app makes it found; a PATH directory does not', async () => {
  const { discover } = await load();
  const P = path.posix; const env = { HOME: '/nx/home/user', PATH: '/usr/local/bin:/opt/bin' };
  const d1 = app(discover(env, 'linux', fake({ paths: { '/usr/share/applications/cursor.desktop': 'file' } }, P)), 'cursor');
  assert.equal(d1.found, true); assert.equal(d1.evidence, 'desktop-file'); assert.equal(d1.install_path, null);
  const d2 = app(discover(env, 'linux', fake({ paths: { '/nx/home/user/.local/share/applications/windsurf.desktop': 'file' } }, P)), 'windsurf');
  assert.equal(d2.evidence, 'desktop-file');
  const d3 = app(discover({ ...env, MEMEV_SYSTEM_DESKTOP: '/x' }, 'linux', fake({ paths: { '/x/code.desktop': 'file' } }, P)), 'vscode');
  assert.equal(d3.found, true);
  const p = app(discover(env, 'linux', fake({ paths: { '/opt/bin/opencode': 'file' } }, P)), 'opencode');
  assert.equal(p.found, true); assert.equal(p.evidence, 'path'); assert.equal(p.install_path, '/opt/bin/opencode');
  assert.equal(app(discover(env, 'linux', fake({ paths: { '/opt/bin/opencode': 'dir' } }, P)), 'opencode').found, false, 'a directory on PATH is not the app');
  // .desktop files are a Linux find only, and on Windows a command is name.exe or name.cmd
  assert.equal(app(discover(env, 'darwin', fake({ paths: { '/usr/share/applications/cursor.desktop': 'file' } }, P)), 'cursor').found, false);
  const w = app(discover({ ...WENV, PATH: 'C:\\Tools;C:\\Bin' }, 'win32', fake({ paths: { 'C:\\Bin\\codex.cmd': 'file' } })), 'codex');
  assert.equal(w.install_path, 'C:\\Bin\\codex.cmd');
  assert.equal(app(discover({ ...WENV, PATH: undefined, Path: 'C:\\Bin' }, 'win32', fake({ paths: { 'C:\\Bin\\grok.exe': 'file' } })), 'grok-build').found, true, 'Windows names it Path');
  assert.equal(app(discover({ ...WENV, PATH: 'C:\\Bin' }, 'win32', fake({ paths: { 'C:\\Bin\\grok': 'file' } })), 'grok-build').found, false);
});

// the old check: a fixture home holding each app's config folder, through each app's own detect()
test('T1-c06: every id of clientDefs and unsupportedDefs has a probe on every platform, and every app the old check found is still found', async () => {
  const { discover, PROBES } = await load();
  const { clientDefs, unsupportedDefs, detect } = await import('../src/cli/clients.mjs');
  for (const platform of ['win32', 'darwin', 'linux']) {
    const ids = [...clientDefs({ HOME: '/h' }, 'memev', platform, { allPlatforms: true }), ...unsupportedDefs({ HOME: '/h' }, platform)].map((d) => d.id);
    for (const id of ids) assert.ok(PROBES[id], `${id} has a probe (${platform})`);
  }
  const home = tmpdir('discover-home-');
  for (const d of ['.claude', '.codex', '.gemini', '.cursor', '.grok', '.grokbot', '.qwen', '.roo', '.continue', '.copilot', path.join('.config', 'opencode'), path.join('.codeium', 'windsurf')]) fs.mkdirSync(path.join(home, d), { recursive: true });
  const env = { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), PATH: '' };
  const old = detect(env, 'memev', 'linux').filter((c) => c.found).map((c) => c.id).sort();
  assert.ok(old.length >= 12, `the fixture is found by the old check: ${old}`);
  const now = discover(env, 'linux', fake({}, path.posix)).apps.filter((a) => a.found);
  assert.deepEqual(now.map((a) => a.id).sort(), old, 'the same apps');
  assert.ok(now.every((a) => a.evidence === 'config'));
  const res = discover(env, 'linux', fake({}, path.posix));
  assert.equal(app(res, 'roo').automation, 'none', 'an app Memev cannot connect');
  assert.equal(app(res, 'codex').automation, 'auto');
  assert.equal(app(res, 'codex').step, null);
  assert.equal(res.apps.filter((a) => a.id === 'factory-droid').length, 1, 'an app listed twice on Windows appears once');
  assert.equal(discover(env, 'win32', fake({})).apps.filter((a) => a.id === 'factory-droid').length, 1);
  assert.equal(app(discover(env, 'win32', fake({})), 'factory-droid').automation, 'none', 'its docs give no Windows place');
});

test('T1-c07: no process runs except the absolute system reg.exe, without a shell, once per hive, with a time limit', async (t) => {
  const m = await load();
  assert.equal(typeof m.parseReg, 'function');
  const seen = [];
  const listing = `HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Grok\r\n    DisplayName    REG_SZ    Grok Bot\r\n    Publisher    REG_SZ    xAI\r\n    DisplayIcon    REG_SZ    C:\\G\\g.exe,0\r\n\r\nHKEY_CURRENT_USER\\x\\Empty\r\n`;
  let answer = () => ({ status: 0, stdout: listing });
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork', 'exec', 'execSync']) {
    t.mock.method(cp, name, (...args) => { seen.push([name, ...args]); return name === 'spawnSync' ? answer() : undefined; });
  }
  syncBuiltinESMExports();
  try {
    const res = m.discover(WENV, 'win32');
    assert.equal(seen.length, 3, 'three hives, three queries');
    for (const [i, [name, exe, args, opts]] of seen.entries()) {
      assert.equal(name, 'spawnSync');
      assert.equal(exe, 'C:\\Windows\\System32\\reg.exe'); assert.ok(W.isAbsolute(exe));
      assert.deepEqual(args, ['query', m.HIVES[i], '/s']);
      assert.equal(opts.shell, false); assert.equal(opts.windowsHide, true); assert.ok(opts.timeout > 0 && opts.timeout <= 30000);
      assert.equal(opts.encoding, 'utf8'); assert.ok(opts.maxBuffer >= 1 << 20);
    }
    const g = app(res, 'grok-bot');
    assert.equal(g.found, true); assert.equal(g.install_path, 'C:\\G');
    assert.deepEqual(m.parseReg(listing), [{ DisplayName: 'Grok Bot', DisplayIcon: 'C:\\G\\g.exe,0' }], 'only the four values, and no empty entry');
    assert.deepEqual(m.parseReg('    DisplayName    REG_SZ    Orphan\n'), [], 'a value before any key is not an entry');
    seen.length = 0;
    m.discover({ HOME: '/h', PATH: '/usr/bin' }, 'linux');
    m.discover({ HOME: '/h', PATH: '/usr/bin' }, 'darwin');
    assert.equal(seen.length, 0, 'no process on macOS or Linux');
    // a hive that times out, and one that fails
    answer = () => ({ error: Object.assign(new Error('t'), { code: 'ETIMEDOUT' }), status: null, stdout: '' });
    const res2 = m.discover(WENV, 'win32');
    assert.equal(res2.problems.length, 3); assert.equal(res2.problems[0].hive, m.HIVES[0]);
    answer = () => ({ status: 1, stdout: listing });
    const res3 = m.discover(WENV, 'win32');
    assert.equal(res3.problems.length, 0); assert.equal(app(res3, 'grok-bot').found, false, 'a failed query gives no entries');
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test('T1-c08: no file content is read; links that leave the searched folders or lead into an app\'s data are not used', async (t) => {
  const m = await load();
  const reads = [];
  const spy = (obj, name) => t.mock.method(obj, name, function (...a) { reads.push([name, String(a[0])]); throw new Error(`discover read ${name}`); });
  for (const n of ['readFile', 'readFileSync', 'open', 'openSync', 'createReadStream', 'readSync']) spy(fs, n);
  for (const n of ['readFile', 'open']) spy(fs.promises, n);
  syncBuiltinESMExports();
  const home = fs.realpathSync(tmpdir('discover-links-'));
  const bin = path.join(home, 'bin'); const outside = fs.realpathSync(tmpdir('discover-outside-'));
  try {
    fs.mkdirSync(path.join(home, '.claude', 'local'), { recursive: true }); fs.mkdirSync(bin);
    fs.writeFileSync(path.join(outside, 'codex'), 'x'); fs.writeFileSync(path.join(home, '.claude', 'local', 'secret'), 'x');
    fs.writeFileSync(path.join(home, 'real-gemini'), 'x');
    fs.symlinkSync(path.join(outside, 'codex'), path.join(bin, 'codex'));
    fs.symlinkSync(path.join(home, '.claude', 'local', 'secret'), path.join(bin, 'opencode'));
    fs.symlinkSync(path.join(home, 'real-gemini'), path.join(bin, 'gemini'));
    fs.writeFileSync(path.join(bin, 'qwen'), 'x');
    const env = { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), PATH: bin };
    const res = m.discover(env, 'linux');
    assert.deepEqual(reads, [], 'no read or open call');
    assert.equal(app(res, 'codex').found, false, 'a link that leaves the searched folders');
    assert.equal(app(res, 'opencode').found, false, 'a link into an app\'s data folder');
    assert.equal(app(res, 'gemini-cli').install_path, path.join(bin, 'gemini'), 'a link inside them counts');
    assert.equal(app(res, 'qwen-code').install_path, path.join(bin, 'qwen'));
    assert.equal(app(res, 'claude-code').evidence, 'config', 'its config folder is still found by name');
    assert.equal(m.readers.stat(path.join(home, 'nothing')), null);
    assert.deepEqual(m.readers.list(path.join(home, 'nothing')), []);
    assert.deepEqual(m.readers.stat(path.join(bin, 'gemini')), { dir: false, file: true, real: path.join(home, 'real-gemini') });
    assert.equal(m.readers.stat(home).dir, true);
    // Roaming and Application Support are data too
    const ad = path.join(home, 'Roaming'); fs.mkdirSync(path.join(ad, 'X'), { recursive: true }); fs.writeFileSync(path.join(ad, 'X', 'q'), 'x');
    fs.rmSync(path.join(bin, 'qwen')); fs.symlinkSync(path.join(ad, 'X', 'q'), path.join(bin, 'qwen'));
    assert.equal(app(m.discover({ ...env, XDG_CONFIG_HOME: ad }, 'linux'), 'qwen-code').found, false, 'the settings folder on Linux');
    const sup = path.join(home, 'Library', 'Application Support', 'Y'); fs.mkdirSync(sup, { recursive: true }); fs.writeFileSync(path.join(sup, 'q'), 'x');
    fs.rmSync(path.join(bin, 'qwen')); fs.symlinkSync(path.join(sup, 'q'), path.join(bin, 'qwen'));
    assert.equal(app(m.discover({ ...env, MEMEV_SYSTEM_APPS: path.join(home, 'none') }, 'darwin'), 'qwen-code').found, false);
    assert.equal(m.iconFolder(''), ''); assert.equal(m.iconFolder('"C:\\A B\\c.exe",-3'), 'C:\\A B');
    // a home folder reached through a link: what is inside it still counts, as its real path is compared
    const via = path.join(outside, 'home-link'); fs.symlinkSync(home, via);
    const viaBin = path.join(via, 'bin');
    const v = m.discover({ HOME: via, XDG_CONFIG_HOME: path.join(via, '.config'), PATH: viaBin }, 'linux');
    assert.equal(app(v, 'gemini-cli').install_path, path.join(viaBin, 'gemini'), 'the link into the linked home is inside it');
    assert.deepEqual(reads, []);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test('T1-c09: a registry query that times out leaves discovery working from folders and PATH, and --json reports it', async () => {
  const { discover } = await load();
  const cur = `${WENV.LOCALAPPDATA}\\Programs\\cursor`;
  const r = fake({ paths: { [cur]: 'dir', 'C:\\Tools\\codex.exe': 'file' }, timeout: [HKCU, WOW], hives: { [HKLM]: [{ DisplayName: 'Microsoft Copilot' }] } });
  const res = discover(WENV, 'win32', r);
  assert.deepEqual(res.problems.map((p) => p.hive), [HKCU, WOW]);
  assert.match(res.problems[0].problem, /timed out/);
  assert.equal(app(res, 'cursor').found, true); assert.equal(app(res, 'codex').found, true);
  assert.equal(app(res, 'microsoft-copilot').found, true, 'the hive that answered still counts');
  assert.deepEqual(discover(WENV, 'win32', fake({})).problems, []);
});

test('T1-c10: memev discover --json prints the documented shape and exits 0 on an empty home', async () => {
  await load();
  const home = tmpdir('discover-empty-');
  const env = { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), MEMEV_CONFIG_DIR: path.join(home, '.config', 'memev'), MEMEV_ROOT: path.join(home, 'memev'), PATH: path.join(home, 'nobin'), MEMEV_SYSTEM_APPS: path.join(home, 'none'), MEMEV_SYSTEM_DESKTOP: path.join(home, 'none'), MEMEV_PORT: '7801', MEMEV_NO_SERVICE: '1', MEMEV_NO_BACKGROUND: '1' };
  const r = spawnSync(process.execPath, [path.join(PKG, 'bin', 'memev.mjs'), 'discover', '--json'], { env, encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.platform, process.platform);
  assert.ok(Array.isArray(j.apps) && j.apps.length >= 40); assert.deepEqual(j.problems, process.platform === 'win32' ? j.problems : []);
  for (const a of j.apps) {
    assert.deepEqual(Object.keys(a), ['id', 'name', 'found', 'evidence', 'install_path', 'automation', 'step']);
    assert.ok(['auto', 'one-step', 'none'].includes(a.automation));
  }
  if (process.platform !== 'win32') assert.equal(j.apps.filter((a) => a.found).length, 0, 'nothing in an empty home');
  const gb = j.apps.find((a) => a.id === 'grok-bot');
  assert.equal(gb.automation, 'one-step'); assert.match(gb.step, /http:\/\/127\.0\.0\.1:7801\/mcp/);
  const txt = spawnSync(process.execPath, [path.join(PKG, 'bin', 'memev.mjs'), 'discover'], { env, encoding: 'utf8', timeout: 30000 });
  assert.equal(txt.status, 0);
  if (process.platform !== 'win32') assert.match(txt.stdout, /No AI apps found/);
  // the port of this computer's vault, when the environment does not give one
  fs.mkdirSync(path.join(home, 'memev', '.memev'), { recursive: true }); fs.writeFileSync(path.join(home, 'memev', '.memev', 'config.json'), '{"port": 7811}');
  const cfg = JSON.parse(spawnSync(process.execPath, [path.join(PKG, 'bin', 'memev.mjs'), 'discover', '--json'], { env: { ...env, MEMEV_PORT: '' }, encoding: 'utf8', timeout: 30000 }).stdout);
  assert.match(cfg.apps.find((a) => a.id === 'grok-bot').step, /:7811\/mcp/);
  fs.mkdirSync(path.join(home, '.codex'));
  const one = spawnSync(process.execPath, [path.join(PKG, 'bin', 'memev.mjs'), 'discover'], { env, encoding: 'utf8', timeout: 30000 });
  assert.match(one.stdout, /Codex CLI\s+Memev connects it \(config\)/);
  assert.doesNotMatch(one.stdout, /No AI apps found/);
});
