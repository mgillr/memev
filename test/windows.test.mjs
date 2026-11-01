// Windows has no POSIX mode bits: the privacy check reads the ACL with icacls where it exists, and otherwise
// accepts files that sit under the user profile. The platform is injected, so these run on any machine.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, initWithRetry } from './helpers/cli.mjs';
import { tmpdir, cleanup } from './helpers/tmp.mjs';
import { fileChecks } from '../src/cli/doctor.mjs';
import { firstRun } from '../src/cli/onboarding.mjs';
import { clientDefs } from '../src/cli/clients.mjs';
import { VERSION } from '../src/engine/vault.mjs';

let sb;
const STATE_FILES = ['tokens.json', 'admin.json', 'clients.json', 'tunnel-key.txt', 'config.json'];
const noIcacls = () => null; // icacls is not on this machine
const perm = (checks) => checks.find((c) => c.id === 'permissions');
// what Windows reports for every file: it has no 0600, so the mode bits always look open
function openModes() {
  const state = path.join(sb.root, '.memev');
  fs.chmodSync(state, 0o777);
  for (const f of STATE_FILES) if (fs.existsSync(path.join(state, f))) fs.chmodSync(path.join(state, f), 0o666);
}

before(() => {
  sb = sandbox();
  const r = initWithRetry(sb, ['init', '--port', String(sb.port), '--no-connect']);
  assert.equal(r.code, 0, r.out + r.err);
  openModes();
});
after(() => { sb.stop(); cleanup(); });

test('MEM-012 AC01: With platform win32 injected and files reporting mode 0o666, private files are private passes when under the profile', () => {
  const state = path.join(sb.root, '.memev');
  assert.equal(fs.statSync(path.join(state, 'tokens.json')).mode & 0o777, 0o666, 'the files report mode 0o666');
  const win = perm(fileChecks({ root: sb.root, env: sb.env, platform: 'win32', icacls: noIcacls }));
  assert.equal(win.status, 'ok', win.detail);
  assert.match(win.detail, /user profile/);
  // the same files on a POSIX platform are still reported as open
  const posix = perm(fileChecks({ root: sb.root, env: sb.env, platform: 'linux' }));
  assert.equal(posix.status, 'fail');
  assert.match(posix.detail, /readable by others/);
  // outside the profile and with no icacls the check cannot tell: it warns and does not fail
  const other = { ...sb.env, HOME: path.join(sb.home, 'elsewhere'), USERPROFILE: path.join(sb.home, 'elsewhere') };
  const away = perm(fileChecks({ root: sb.root, env: other, platform: 'win32', icacls: noIcacls }));
  assert.equal(away.status, 'warn');
});

test('MEM-012 AC01: with icacls, the ACL decides: other users on a file fail, the user, the system and administrators pass', () => {
  const listing = (file, entries) => `${file} ${entries[0]}\n${entries.slice(1).map((e) => `${' '.repeat(file.length + 1)}${e}`).join('\n')}\n\nSuccessfully processed 1 files; Failed processing 0 files\n`;
  const mine = { ...sb.env, USERNAME: 'rider' };
  const good = (args) => listing(args[0], ['NT AUTHORITY\\SYSTEM:(I)(F)', 'BUILTIN\\Administrators:(I)(F)', 'HOST\\rider:(I)(F)']);
  const bad = (args) => listing(args[0], ['HOST\\rider:(I)(F)', 'BUILTIN\\Users:(I)(RX)', 'Everyone:(I)(R)']);
  const ok = perm(fileChecks({ root: sb.root, env: mine, platform: 'win32', icacls: good }));
  assert.equal(ok.status, 'ok', ok.detail);
  assert.match(ok.detail, /icacls/);
  const open = perm(fileChecks({ root: sb.root, env: mine, platform: 'win32', icacls: bad }));
  assert.equal(open.status, 'fail');
  assert.match(open.detail, /readable by others: .*tokens\.json/);
  assert.ok(open.fix?.run, 'there is a fix that restricts them');
});

test('MEM-012 AC02: With platform win32 injected, init self-test exit code is 0 on an otherwise healthy install', async () => {
  // a clean linux check of the same install fails on the open modes, so the pass below is the platform's doing
  const log = console.log; console.log = () => {};
  let code, linux;
  try {
    linux = await firstRun({ root: sb.root, env: sb.env, flags: { 'no-connect': true, 'no-service': true }, daemonUp: true, platform: 'linux' });
    openModes();
    code = await firstRun({ root: sb.root, env: sb.env, flags: { 'no-connect': true, 'no-service': true }, daemonUp: true, platform: 'win32', icacls: noIcacls });
  } finally { console.log = log; }
  assert.equal(linux, 1, 'with POSIX rules the open modes fail the self-test');
  assert.equal(code, 0, 'with win32 injected the self-test passes');
  const items = JSON.parse(fs.readFileSync(path.join(sb.root, '.memev', 'onboarding.json'), 'utf8')).items;
  const st = items.find((i) => /Self-test/.test(i.step));
  assert.equal(st.status, 'succeeded', st.detail);
});

// Since Node's CVE-2024-27980 fix, a Node app cannot spawn a .cmd file without a shell, so on win32 the
// MCP and hook entries register node.exe with the runtime script as arguments, never the memev.cmd launcher.
const winEnv = () => { const home = tmpdir('home-'); return { home, env: { HOME: home, MEMEV_CONFIG_DIR: path.join(home, '.config', 'memev') } }; };
const winLauncher = (env) => path.join(env.MEMEV_CONFIG_DIR, 'bin', 'memev.cmd');
const mcpEntries = (obj, out = []) => { for (const [k, v] of Object.entries(obj || {})) { if (k === 'memev' && v && typeof v === 'object' && 'command' in v) out.push(v); else if (v && typeof v === 'object') mcpEntries(v, out); } return out; };
const hookCommands = (o, out = []) => { if (typeof o === 'string') { if (/ hook /.test(o)) out.push(o); return out; } if (Array.isArray(o)) { for (const x of o) hookCommands(x, out); return out; } if (o && typeof o === 'object') for (const v of Object.values(o)) hookCommands(v, out); return out; };

test('MEM-011 AC01: with platform win32 injected, every MCP entry registers node.exe and no command or arg ends in .cmd or .bat', () => {
  const { env } = winEnv();
  const launcher = winLauncher(env); // a .cmd launcher must not leak into any entry
  const defs = clientDefs(env, launcher, 'win32');
  assert.ok(defs.length >= 8, 'every known app is defined');
  for (const def of defs) {
    let found = 0;
    for (const e of def.edits()) {
      if (e.kind === 'json') {
        for (const entry of mcpEntries(e.apply({}))) {
          found++;
          // OpenCode takes the command and its arguments as one array; the others split command and args
          const argv = [].concat(entry.command, entry.args || []);
          assert.ok(argv[0].endsWith('node.exe'), `${def.id}: command ${argv[0]}`);
          for (const s of argv) assert.ok(!/\.(cmd|bat)$/i.test(s), `${def.id}: ${s}`);
        }
      } else {
        const t = e.apply('');
        const m = t.match(/command = "([^"]*)"/);
        if (m) { found++; assert.ok(m[1].endsWith('node.exe'), `${def.id}: ${m[1]}`); }
        assert.ok(!/\.cmd|\.bat/.test(t), `${def.id}: ${t}`);
      }
    }
    assert.equal(found, 1, `${def.id} has exactly one MCP entry`);
  }
});

test('MEM-011 AC02: with platform win32 injected, every hook command runs node.exe with the memev.mjs path as its first argument', () => {
  const { env } = winEnv();
  const script = path.join(env.MEMEV_CONFIG_DIR, 'runtime', VERSION, 'bin', 'memev.mjs');
  const defs = clientDefs(env, winLauncher(env), 'win32');
  let hooks = 0;
  for (const def of defs) {
    for (const e of def.edits()) {
      if (e.kind !== 'json') continue;
      for (const cmd of hookCommands(e.apply({}))) {
        hooks++;
        const quoted = [...cmd.matchAll(/"([^"]*)"/g)].map((q) => q[1]);
        assert.ok(quoted.length >= 2, cmd);
        assert.ok(quoted[0].endsWith('node.exe'), cmd);
        assert.equal(quoted[1], script, cmd);
        assert.ok(cmd.startsWith(`"${quoted[0]}" "${quoted[1]}" hook `), cmd);
      }
    }
  }
  assert.ok(hooks >= 16, `hook commands found: ${hooks}`);
});
