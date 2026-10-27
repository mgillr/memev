// Windows has no POSIX mode bits: the privacy check reads the ACL with icacls where it exists, and otherwise
// accepts files that sit under the user profile. The platform is injected, so these run on any machine.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';
import { fileChecks } from '../src/cli/doctor.mjs';
import { firstRun } from '../src/cli/onboarding.mjs';

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
  const r = sb.run(['init', '--port', String(sb.port), '--no-connect']);
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
