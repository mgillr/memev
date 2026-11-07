// The apps added for breadth: each is connected at the path and key its own MCP docs give (docs/CLIENTS.md
// cites them). For every app: connect writes the entry and keeps the person's other servers and settings, a
// second connect changes nothing, disconnect after the person edited the file removes only Memev's entry,
// detection follows the documented folder, and on win32 the Windows path and the node.exe launcher are used.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { connect, disconnect, detect, clientDefs, unsupportedDefs, RESTART } from '../src/cli/clients.mjs';
import { VERSION } from '../src/engine/vault.mjs';
import { tmpdir, cleanup } from './helpers/tmp.mjs';
after(() => cleanup());

const BIN = '/x/memev';
// A sandbox HOME and APPDATA, so nothing on this machine is read or written.
function sandboxEnv() {
  const home = tmpdir('home-');
  return { home, env: { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'), MEMEV_CONFIG_DIR: path.join(home, '.config', 'memev') } };
}
const linuxArgs = (id) => ['mcp', '--client', id];
const dig = (o, keys) => keys.reduce((x, k) => (x == null ? x : x[k]), o);
const put = (o, keys, v) => { let x = o; for (const k of keys.slice(0, -1)) x = x[k] ??= {}; x[keys[keys.length - 1]] = v; return o; };

// dir: the folder whose presence means the app is installed; file: the MCP config; key: where servers live;
// entry: what Memev writes on Linux; other: a server of the person's own, in the app's shape.
// win: the config file on win32, or false when the docs name no Windows location.
const JSON_APPS = [
  { id: 'qwen-code', dir: (h) => path.join(h, '.qwen'), file: (h) => path.join(h, '.qwen', 'settings.json'), key: ['mcpServers'],
    entry: { command: BIN, args: linuxArgs('qwen-code') }, win: (h) => path.join(h, '.qwen', 'settings.json') },
  { id: 'kimi-code', dir: (h) => path.join(h, '.kimi-code'), file: (h) => path.join(h, '.kimi-code', 'mcp.json'), key: ['mcpServers'],
    entry: { command: BIN, args: linuxArgs('kimi-code') }, win: (h) => path.join(h, '.kimi-code', 'mcp.json') },
  { id: 'factory-droid', dir: (h) => path.join(h, '.factory'), file: (h) => path.join(h, '.factory', 'mcp.json'), key: ['mcpServers'],
    entry: { type: 'stdio', command: BIN, args: linuxArgs('factory-droid') }, win: false },
  { id: 'augment', dir: (h) => path.join(h, '.augment'), file: (h) => path.join(h, '.augment', 'settings.json'), key: ['mcpServers'],
    entry: { command: BIN, args: linuxArgs('augment') }, win: false },
  { id: 'tabnine', dir: (h) => path.join(h, '.tabnine', 'agent'), file: (h) => path.join(h, '.tabnine', 'agent', 'settings.json'), key: ['mcpServers'],
    entry: { command: BIN, args: linuxArgs('tabnine') }, win: false },
  { id: 'iflow', dir: (h) => path.join(h, '.iflow'), file: (h) => path.join(h, '.iflow', 'settings.json'), key: ['mcpServers'],
    entry: { command: BIN, args: linuxArgs('iflow') }, win: (h) => path.join(h, '.iflow', 'settings.json') },
  { id: 'warp', dir: (h) => path.join(h, '.warp'), file: (h) => path.join(h, '.warp', '.mcp.json'), key: ['mcpServers'],
    entry: { command: BIN, args: linuxArgs('warp') }, win: false },
  { id: 'lmstudio', dir: (h) => path.join(h, '.lmstudio'), file: (h) => path.join(h, '.lmstudio', 'mcp.json'), key: ['mcpServers'],
    entry: { command: BIN, args: linuxArgs('lmstudio') }, win: (h) => path.join(h, '.lmstudio', 'mcp.json') },
  { id: 'anythingllm', dir: (h) => path.join(h, '.config', 'anythingllm-desktop', 'storage'), file: (h) => path.join(h, '.config', 'anythingllm-desktop', 'storage', 'plugins', 'anythingllm_mcp_servers.json'), key: ['mcpServers'],
    entry: { command: BIN, args: linuxArgs('anythingllm') }, win: (h) => path.join(h, 'AppData', 'Roaming', 'anythingllm-desktop', 'storage', 'plugins', 'anythingllm_mcp_servers.json') },
  { id: 'oterm', dir: (h) => path.join(h, '.local', 'share', 'oterm'), file: (h) => path.join(h, '.local', 'share', 'oterm', 'config.json'), key: ['mcpServers'],
    entry: { command: BIN, args: linuxArgs('oterm') }, win: (h) => path.join(h, 'AppData', 'Roaming', 'oterm', 'config.json') },
  { id: 'muse-code', dir: (h) => path.join(h, '.config', 'muse'), file: (h) => path.join(h, '.config', 'muse', 'settings.json'), key: ['mcp_servers'],
    entry: { transport: 'stdio', command: BIN, args: linuxArgs('muse-code'), mode: 'optional' }, win: false },
  { id: 'zcode', dir: (h) => path.join(h, '.zcode'), file: (h) => path.join(h, '.zcode', 'cli', 'config.json'), key: ['mcp', 'servers'],
    entry: { command: BIN, args: linuxArgs('zcode') }, win: false },
  { id: 'mcphub-nvim', dir: (h) => path.join(h, '.config', 'mcphub'), file: (h) => path.join(h, '.config', 'mcphub', 'servers.json'), key: ['mcpServers'],
    entry: { command: BIN, args: linuxArgs('mcphub-nvim') }, win: false },
  { id: 'codebuddy', dir: (h) => path.join(h, '.codebuddy'), file: (h) => path.join(h, '.codebuddy', '.mcp.json'), key: ['mcpServers'],
    entry: { type: 'stdio', command: BIN, args: linuxArgs('codebuddy') }, win: false },
  { id: 'qoder', dir: (h) => path.join(h, '.qoder'), file: (h) => path.join(h, '.qoder', 'settings.json'), key: ['mcpServers'],
    entry: { command: BIN, args: linuxArgs('qoder') }, win: false },
  { id: 'cline', dir: (h) => path.join(h, '.cline'), file: (h) => path.join(h, '.cline', 'data', 'settings', 'cline_mcp_settings.json'), key: ['mcpServers'],
    entry: { disabled: false, command: BIN, args: linuxArgs('cline') }, win: false },
  { id: 'kiro', dir: (h) => path.join(h, '.kiro'), file: (h) => path.join(h, '.kiro', 'settings', 'mcp.json'), key: ['mcpServers'],
    entry: { command: BIN, args: linuxArgs('kiro') }, win: false },
  { id: 'junie', dir: (h) => path.join(h, '.junie'), file: (h) => path.join(h, '.junie', 'mcp', 'mcp.json'), key: ['mcpServers'],
    entry: { command: BIN, args: linuxArgs('junie') }, win: false },
  { id: 'amp', dir: (h) => path.join(h, '.config', 'amp'), file: (h) => path.join(h, '.config', 'amp', 'settings.json'), key: ['amp.mcpServers'],
    entry: { command: BIN, args: linuxArgs('amp') }, win: (h) => path.join(h, '.config', 'amp', 'settings.json') },
  { id: 'kilo-code', dir: (h) => path.join(h, '.config', 'kilo'), file: (h) => path.join(h, '.config', 'kilo', 'kilo.jsonc'), key: ['mcp'],
    entry: { type: 'local', command: [BIN, ...linuxArgs('kilo-code')], enabled: true }, win: (h) => path.join(h, '.config', 'kilo', 'kilo.jsonc') },
  { id: 'amazon-q-cli', dir: (h) => path.join(h, '.aws', 'amazonq'), file: (h) => path.join(h, '.aws', 'amazonq', 'mcp.json'), key: ['mcpServers'],
    entry: { command: BIN, args: linuxArgs('amazon-q-cli') }, win: false },
  { id: 'openhands', dir: (h) => path.join(h, '.openhands'), file: (h) => path.join(h, '.openhands', 'mcp.json'), key: ['mcpServers'],
    entry: { command: BIN, args: linuxArgs('openhands') }, win: false },
];

const plant = (f, obj) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `${JSON.stringify(obj, null, 2)}\n`); return fs.readFileSync(f); };

for (const app of JSON_APPS) {
  test(`${app.id}: connect writes the documented entry, keeps the person's servers and settings, and a second connect changes nothing`, () => {
    const { home, env } = sandboxEnv();
    const f = app.file(home);
    plant(f, put({ theme: 'dark' }, [...app.key, 'theirs'], { command: 'their-server', args: ['--x'] }));
    const r = connect(app.id, { env, launcher: BIN, platform: 'linux' });
    assert.equal(r.status, 'added');
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.deepEqual(dig(j, [...app.key, 'memev']), app.entry);
    assert.deepEqual(dig(j, [...app.key, 'theirs']), { command: 'their-server', args: ['--x'] }, 'the person\'s server stays');
    assert.equal(j.theme, 'dark', 'other settings stay');
    const bytes = fs.readFileSync(f);
    assert.equal(connect(app.id, { env, launcher: BIN, platform: 'linux' }).status, 'already');
    assert.ok(fs.readFileSync(f).equals(bytes), 'a second connect leaves the file byte for byte');
    assert.ok(RESTART[app.id], 'there is an after-connect line for the app');
  });

  test(`${app.id}: disconnect restores the original bytes, or removes only Memev's entry once the person edited the file`, () => {
    const { home, env } = sandboxEnv();
    const f = app.file(home);
    const original = plant(f, put({}, [...app.key, 'theirs'], { command: 'their-server' }));
    connect(app.id, { env, launcher: BIN, platform: 'linux' });
    disconnect(app.id, { env, platform: 'linux' });
    assert.ok(fs.readFileSync(f).equals(original), 'unchanged since: the original bytes come back');
    connect(app.id, { env, launcher: BIN, platform: 'linux' });
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    put(j, [...app.key, 'added-later'], { command: 'later' });
    fs.writeFileSync(f, JSON.stringify(j, null, 2));
    disconnect(app.id, { env, platform: 'linux' });
    const left = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.equal(dig(left, [...app.key, 'memev']), undefined, 'Memev\'s entry is gone');
    assert.deepEqual(dig(left, [...app.key, 'theirs']), { command: 'their-server' });
    assert.deepEqual(dig(left, [...app.key, 'added-later']), { command: 'later' }, 'the edit made since is kept');
  });

  test(`${app.id}: found only when its documented folder exists`, () => {
    const { home, env } = sandboxEnv();
    assert.equal(detect(env, BIN, 'linux').find((c) => c.id === app.id).found, false);
    fs.mkdirSync(app.dir(home), { recursive: true });
    const c = detect(env, BIN, 'linux').find((x) => x.id === app.id);
    assert.equal(c.found, true);
    assert.equal(c.supported, true);
  });

  test(`${app.id}: on win32 ${app.win ? 'the Windows path and the node.exe launcher are used' : 'it is found but not changed, as its docs name no Windows location'}`, () => {
    const { home, env } = sandboxEnv();
    const defs = clientDefs(env, path.join(env.MEMEV_CONFIG_DIR, 'bin', 'memev.cmd'), 'win32');
    const def = defs.find((d) => d.id === app.id);
    if (!app.win) {
      assert.equal(def, undefined, 'not offered for connecting on Windows');
      fs.mkdirSync(app.dir(home), { recursive: true });
      const u = unsupportedDefs(env, 'win32').find((d) => d.id === app.id);
      assert.ok(u && u.detect(), 'listed as found, not supported on Windows');
      assert.equal(detect(env, BIN, 'win32').find((c) => c.id === app.id).supported, false);
      return;
    }
    const [e] = def.edits();
    assert.equal(e.file, app.win(home));
    const m = dig(e.apply({}), [...app.key, 'memev']);
    const argv = [].concat(m.command, m.args || []); // Kilo takes the command and its arguments as one array
    assert.ok(argv[0].endsWith('node.exe'), argv[0]);
    assert.deepEqual(argv.slice(1), [path.join(env.MEMEV_CONFIG_DIR, 'runtime', VERSION, 'bin', 'memev.mjs'), 'mcp', '--client', app.id]);
  });
}

// Mistral Vibe keeps one [[mcp_servers]] table per server in config.toml.
test('mistral-vibe: connect appends a marked [[mcp_servers]] table, keeps the person\'s tables, is idempotent, and disconnect takes out only that table', () => {
  const { home, env } = sandboxEnv();
  const f = path.join(home, '.vibe', 'config.toml');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const theirs = 'active_model = "devstral"\n\n[[mcp_servers]]\nname = "fetch_server"\ntransport = "stdio"\ncommand = "uvx"\nargs = ["mcp-server-fetch"]\n';
  fs.writeFileSync(f, theirs);
  assert.equal(detect(env, BIN, 'linux').find((c) => c.id === 'mistral-vibe').found, true);
  assert.equal(connect('mistral-vibe', { env, launcher: BIN, platform: 'linux' }).status, 'added');
  const t = fs.readFileSync(f, 'utf8');
  assert.ok(t.startsWith(theirs), 'the person\'s settings and server stay first, untouched');
  assert.match(t, /# memev:start\n\[\[mcp_servers\]\]\nname = "memev"\ntransport = "stdio"\ncommand = "\/x\/memev"\nargs = \["mcp", "--client", "mistral-vibe"\]\n# memev:end\n$/);
  assert.equal(connect('mistral-vibe', { env, launcher: BIN, platform: 'linux' }).status, 'already');
  fs.appendFileSync(f, '\n[[mcp_servers]]\nname = "later"\ntransport = "stdio"\ncommand = "later"\n');
  disconnect('mistral-vibe', { env, platform: 'linux' });
  const left = fs.readFileSync(f, 'utf8');
  assert.equal(left.includes('memev'), false, 'Memev\'s table is gone');
  assert.ok(left.includes('fetch_server') && left.includes('name = "later"'), 'both of the person\'s tables stay');
});

test('mistral-vibe: a server the person already named memev is left as it is, with a note', () => {
  const { home, env } = sandboxEnv();
  const f = path.join(home, '.vibe', 'config.toml');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, '[[mcp_servers]]\nname = "memev"\ntransport = "http"\nurl = "https://example.invalid/mcp"\n');
  const before = fs.readFileSync(f);
  const r = connect('mistral-vibe', { env, launcher: BIN, platform: 'linux' });
  assert.equal(r.status, 'already');
  assert.ok(r.notes.some((n) => /left it as-is/.test(n)));
  assert.ok(fs.readFileSync(f).equals(before));
});

test('mistral-vibe: name = "memev" under another table, such as [[profiles]], is not a server, so Memev still connects', () => {
  const { home, env } = sandboxEnv();
  const f = path.join(home, '.vibe', 'config.toml');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const theirs = '[[profiles]]\nname = "memev"\nmodel = "devstral"\n\n[[mcp_servers]]\nname = "fetch_server"\ntransport = "stdio"\ncommand = "uvx"\n';
  fs.writeFileSync(f, theirs);
  const r = connect('mistral-vibe', { env, launcher: BIN, platform: 'linux' });
  assert.equal(r.status, 'added');
  assert.equal((r.notes || []).some((n) => /left it as-is/.test(n)), false);
  const t = fs.readFileSync(f, 'utf8');
  assert.ok(t.startsWith(theirs));
  assert.match(t, /# memev:start\n\[\[mcp_servers\]\]\nname = "memev"/);
});

test('mistral-vibe: VIBE_HOME moves the file, and on win32 the table runs node.exe', () => {
  const { home, env } = sandboxEnv();
  const vh = path.join(home, 'vibe-elsewhere');
  const def = clientDefs({ ...env, VIBE_HOME: vh }, BIN, 'linux').find((d) => d.id === 'mistral-vibe');
  assert.equal(def.edits()[0].file, path.join(vh, 'config.toml'));
  const w = clientDefs(env, 'memev.cmd', 'win32').find((d) => d.id === 'mistral-vibe').edits()[0];
  assert.equal(w.file, path.join(home, '.vibe', 'config.toml'));
  const t = w.apply('');
  assert.match(t, /command = "[^"]*node\.exe"/);
  assert.ok(!/\.cmd/.test(t), t);
});

test('kimi-code: KIMI_CODE_HOME moves both the folder looked for and the file', () => {
  const { home, env } = sandboxEnv();
  const kh = path.join(home, 'kimi-elsewhere');
  fs.mkdirSync(kh, { recursive: true });
  const e2 = { ...env, KIMI_CODE_HOME: kh };
  assert.equal(detect(e2, BIN, 'linux').find((c) => c.id === 'kimi-code').found, true);
  connect('kimi-code', { env: e2, launcher: BIN, platform: 'linux' });
  assert.ok(fs.existsSync(path.join(kh, 'mcp.json')));
});

test('anythingllm and oterm: the macOS data folders are the ones their docs name, and OTERM_DATA_DIR moves oterm', () => {
  const { home, env } = sandboxEnv();
  const mac = clientDefs(env, BIN, 'darwin');
  const sup = path.join(home, 'Library', 'Application Support');
  assert.equal(mac.find((d) => d.id === 'anythingllm').edits()[0].file, path.join(sup, 'anythingllm-desktop', 'storage', 'plugins', 'anythingllm_mcp_servers.json'));
  assert.equal(mac.find((d) => d.id === 'oterm').edits()[0].file, path.join(sup, 'oterm', 'config.json'));
  const od = path.join(home, 'oterm-data');
  assert.equal(clientDefs({ ...env, OTERM_DATA_DIR: od }, BIN, 'linux').find((d) => d.id === 'oterm').edits()[0].file, path.join(od, 'config.json'));
});

test('muse-code: a new settings file gets schema_version 1, which Muse Code needs, and an existing one keeps its own', () => {
  const { home, env } = sandboxEnv();
  fs.mkdirSync(path.join(home, '.config', 'muse'), { recursive: true });
  connect('muse-code', { env, launcher: BIN, platform: 'linux' });
  const f = path.join(home, '.config', 'muse', 'settings.json');
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).schema_version, 1);
  disconnect('muse-code', { env, platform: 'linux' });
  assert.equal(fs.existsSync(f), false, 'the file Memev created is removed again');
});

test('codebuddy: Memev edits the first file CodeBuddy reads, so an older mcp.json is never shadowed by a new .mcp.json', () => {
  const { home, env } = sandboxEnv();
  const old = plant(path.join(home, '.codebuddy', 'mcp.json'), { mcpServers: { theirs: { command: 'x' } } });
  connect('codebuddy', { env, launcher: BIN, platform: 'linux' });
  assert.equal(fs.existsSync(path.join(home, '.codebuddy', '.mcp.json')), false, 'no new file ahead of theirs');
  const j = JSON.parse(fs.readFileSync(path.join(home, '.codebuddy', 'mcp.json'), 'utf8'));
  assert.ok(j.mcpServers.memev && j.mcpServers.theirs);
  disconnect('codebuddy', { env, platform: 'linux' });
  assert.ok(fs.readFileSync(path.join(home, '.codebuddy', 'mcp.json')).equals(old));
});

test('codebuddy: a JSONC file with comments keeps its comments', () => {
  const { home, env } = sandboxEnv();
  const f = path.join(home, '.codebuddy', '.mcp.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, '{\n  // my servers\n  "mcpServers": {\n    "theirs": { "command": "x" },\n  },\n}\n');
  assert.equal(connect('codebuddy', { env, launcher: BIN, platform: 'linux' }).status, 'added');
  const t = fs.readFileSync(f, 'utf8');
  assert.match(t, /\/\/ my servers/);
  assert.match(t, /"memev"/);
});

test('cline: CLINE_MCP_SETTINGS_PATH moves the file', () => {
  const { home, env } = sandboxEnv();
  const f = path.join(home, 'elsewhere', 'mcp.json');
  assert.equal(clientDefs({ ...env, CLINE_MCP_SETTINGS_PATH: f }, BIN, 'linux').find((d) => d.id === 'cline').edits()[0].file, f);
});

test('amp and kilo-code: the file the person already has is the one edited (settings.jsonc, kilo.json)', () => {
  const { home, env } = sandboxEnv();
  plant(path.join(home, '.config', 'amp', 'settings.jsonc'), { 'amp.notifications.enabled': false });
  plant(path.join(home, '.config', 'kilo', 'kilo.json'), { mcp: {} });
  const defs = clientDefs(env, BIN, 'linux');
  assert.equal(defs.find((d) => d.id === 'amp').edits()[0].file, path.join(home, '.config', 'amp', 'settings.jsonc'));
  assert.equal(defs.find((d) => d.id === 'kilo-code').edits()[0].file, path.join(home, '.config', 'kilo', 'kilo.json'));
  connect('amp', { env, launcher: BIN, platform: 'linux' });
  const j = JSON.parse(fs.readFileSync(path.join(home, '.config', 'amp', 'settings.jsonc'), 'utf8'));
  assert.equal(j['amp.notifications.enabled'], false);
  assert.deepEqual(j['amp.mcpServers'].memev, { command: BIN, args: linuxArgs('amp') });
  assert.equal(fs.existsSync(path.join(home, '.config', 'amp', 'settings.json')), false, 'no second settings file');
});

test('apps kept in a settings screen are found, never changed, and come with the way to add Memev by hand', () => {
  const { home, env } = sandboxEnv();
  const dirs = { jan: path.join(home, '.local', 'share', 'Jan', 'data'), 'cherry-studio': path.join(home, '.config', 'CherryStudio'), lingma: path.join(home, '.lingma'), rovodev: path.join(home, '.rovodev'), crush: path.join(home, '.config', 'crush') };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  const found = detect(env, BIN, 'linux');
  for (const id of Object.keys(dirs)) {
    const c = found.find((x) => x.id === id);
    assert.equal(c.found, true, id);
    assert.equal(c.supported, false, id);
    assert.ok(c.manual, `${id} has a manual step`);
  }
  const winJan = path.join(home, 'AppData', 'Roaming', 'Jan', 'data');
  fs.mkdirSync(winJan, { recursive: true });
  assert.equal(unsupportedDefs(env, 'win32').find((d) => d.id === 'jan').detect(), true, 'Jan on Windows is looked for under %APPDATA%');
  assert.equal(unsupportedDefs(env, 'linux').find((d) => d.id === 'boltai').detect(), false, 'BoltAI is a Mac app');
});
