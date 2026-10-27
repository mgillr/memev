// The memev command after a source install: init names the launcher by its full path while its folder is not on
// PATH, and `memev path add|remove` puts the folder on PATH (and takes it out) with one line, once.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';
import { addToPath, removeFromPath, onPath, userPath, commandName, fullPathHints, withHints, offer, rcTarget } from '../src/cli/pathsetup.mjs';

after(cleanup);

const BARE = /(^|[\s(`'"·:;,])memev (init|connect|disconnect|clients|status|doctor|cloud|github|service|devices|invite|join|license|bus|recall|card|remember|why|review|audit|path|preflight|onboarding|start|stop)\b/m;

test('MEM-040 AC01: When the launcher dir is not on PATH, every memev hint in the init output uses the full launcher path', () => {
  const sb = sandbox();
  const launcher = path.join(sb.env.MEMEV_CONFIG_DIR, 'bin', 'memev');
  assert.equal(onPath(path.dirname(launcher), sb.env), false, 'the sandbox PATH does not hold the launcher folder');
  const r = sb.run(['init', '--port', String(sb.port)]);
  assert.equal(r.code, 0, r.out + r.err);
  const text = r.out + r.err;
  assert.doesNotMatch(text, BARE, `a bare memev hint is left:\n${text.split('\n').filter((l) => BARE.test(l)).join('\n')}`);
  assert.match(text, new RegExp(`${launcher.replace(/[/.]/g, '\\$&')} github setup`), 'the backup hint names the launcher');
  assert.match(text, /memev command: not on your PATH yet/);
  // with the folder on PATH the hints stay short
  const on = sb.run(['onboarding'], { extraEnv: { PATH: `${path.dirname(launcher)}${path.delimiter}${process.env.PATH}` } });
  assert.match(on.out, /memev github setup/);
  assert.ok(!on.out.includes(`${launcher} github`));
  assert.match(on.out, /memev command: on your PATH/);
  // machine-readable output is left alone
  assert.doesNotThrow(() => JSON.parse(sb.run(['onboarding', '--json']).out));
});

test('MEM-040 AC01: hints are rewritten only for real commands, in the console output of init and onboarding', async () => {
  const L = '/home/x/.config/memev/bin/memev';
  assert.equal(fullPathHints('run memev doctor, then memev github setup (two minutes)', L), `run ${L} doctor, then ${L} github setup (two minutes)`);
  assert.equal(fullPathHints('Memev is running; your memev vault', L), 'Memev is running; your memev vault');
  assert.equal(fullPathHints('see (memev bus operator <seat>)', L), `see (${L} bus operator <seat>)`);
  assert.equal(commandName({ PATH: '/usr/bin', MEMEV_CONFIG_DIR: '/c' }), '/c/bin/memev');
  assert.equal(commandName({ PATH: '/usr/bin:/c/bin/', MEMEV_CONFIG_DIR: '/c' }), 'memev');
  assert.equal(commandName({ PATH: '/usr/bin', MEMEV_CONFIG_DIR: '/my dir' }), '"/my dir/bin/memev"');
  const seen = []; const log = console.log; console.log = (...a) => seen.push(a.join(' '));
  try { await withHints({ PATH: '/usr/bin', MEMEV_CONFIG_DIR: '/c' }, ['init'], async () => console.log('now run memev doctor')); } finally { console.log = log; }
  assert.deepEqual(seen, ['now run /c/bin/memev doctor']);
  assert.equal(console.log, log, 'console.log is restored');
});

const rcEnv = (sb, shell) => ({ SHELL: shell });

test('MEM-040 AC02: memev path add appends one PATH line to the user shell rc file once (idempotent) and memev path remove removes it', () => {
  const sb = sandbox();
  const rc = path.join(sb.home, '.zshrc');
  fs.writeFileSync(rc, 'alias ll="ls -l"');  // no trailing newline: the line must still start on its own line
  const bin = path.join(sb.env.MEMEV_CONFIG_DIR, 'bin');
  const a = sb.run(['path', 'add'], { extraEnv: rcEnv(sb, '/bin/zsh') });
  assert.equal(a.code, 0, a.out + a.err);
  let text = fs.readFileSync(rc, 'utf8');
  assert.equal(text.split('\n').filter((l) => l.includes(bin)).length, 1, 'one PATH line');
  assert.match(text, new RegExp(`^alias ll="ls -l"\\nexport PATH="${bin.replace(/[/.]/g, '\\$&')}:\\$PATH" # added by memev\\n$`));
  // again: nothing changes
  const before = text;
  const b = sb.run(['path', 'add'], { extraEnv: rcEnv(sb, '/bin/zsh') });
  assert.equal(b.code, 0); assert.match(b.out, /already/);
  assert.equal(fs.readFileSync(rc, 'utf8'), before, 'second add changes nothing');
  assert.match(sb.run(['path', 'status']).out, /not on PATH/);
  // remove: the line goes and the rest of the file stays
  const c = sb.run(['path', 'remove'], { extraEnv: rcEnv(sb, '/bin/zsh') });
  assert.equal(c.code, 0, c.out + c.err);
  assert.equal(fs.readFileSync(rc, 'utf8'), 'alias ll="ls -l"\n');
  assert.match(sb.run(['path', 'remove'], { extraEnv: rcEnv(sb, '/bin/zsh') }).out, /Nothing to remove/);
});

test('MEM-040 AC02: the rc file follows the shell, and a file that does not exist yet is created', () => {
  const sb = sandbox(); const env = sb.env;
  const bin = path.join(env.MEMEV_CONFIG_DIR, 'bin');
  assert.equal(rcTarget(bin, { ...env, SHELL: '/bin/bash' }, 'linux').file, path.join(sb.home, '.bashrc'));
  assert.equal(rcTarget(bin, { ...env, SHELL: '/bin/bash' }, 'darwin').file, path.join(sb.home, '.bash_profile'));
  assert.equal(rcTarget(bin, { ...env, SHELL: '/usr/bin/fish' }, 'linux').file, path.join(sb.home, '.config', 'fish', 'config.fish'));
  assert.equal(rcTarget(bin, { ...env, SHELL: '' }, 'linux').file, path.join(sb.home, '.profile'));
  const r = addToPath({ env: { ...env, SHELL: '/usr/bin/fish' }, platform: 'linux' });
  assert.equal(r.changed, true);
  assert.match(fs.readFileSync(path.join(sb.home, '.config', 'fish', 'config.fish'), 'utf8'), /^fish_add_path ".*bin" # added by memev\n$/);
});

test('MEM-040 AC03: With platform win32 injected, memev path add updates only the user PATH (stubbed), never the system PATH', () => {
  const calls = []; let stored = 'C:\\Windows;C:\\Users\\me\\bin';
  const reg = userPath((args) => {
    calls.push(args);
    if (args[0] === 'query') return { ok: true, out: `\nHKEY_CURRENT_USER\\Environment\n    Path    REG_EXPAND_SZ    ${stored}\n\n` };
    stored = args[args.indexOf('/d') + 1]; return { ok: true, out: '' };
  });
  const env = { MEMEV_CONFIG_DIR: 'C:\\Users\\me\\AppData\\Roaming\\memev', HOME: 'C:\\Users\\me' };
  const dir = 'C:\\Users\\me\\AppData\\Roaming\\memev\\bin';
  const a = addToPath({ env, platform: 'win32', dir, reg });
  assert.equal(a.changed, true);
  assert.equal(stored, `C:\\Windows;C:\\Users\\me\\bin;${dir}`, 'appended to the existing user PATH, nothing else touched');
  assert.equal(addToPath({ env, platform: 'win32', dir, reg: reg }).changed, false, 'once');
  assert.equal(addToPath({ env, platform: 'win32', dir: dir.toUpperCase(), reg }).changed, false, 'paths compare without case on Windows');
  const r = removeFromPath({ env, platform: 'win32', dir, reg });
  assert.equal(r.changed, true); assert.equal(stored, 'C:\\Windows;C:\\Users\\me\\bin');
  // every registry command named the user's own environment; none the machine's
  for (const args of calls) {
    assert.ok(args.includes('HKCU\\Environment'), `user key: ${args.join(' ')}`);
    assert.ok(!args.some((x) => /HKLM|HKEY_LOCAL_MACHINE|\/M\b|Session Manager/i.test(x)), `no system PATH: ${args.join(' ')}`);
  }
  assert.ok(calls.some((x) => x[0] === 'add'));
  assert.equal(fs.existsSync(path.join('/', 'nope')), false);
  // no rc file is written on win32
  const sb = sandbox();
  addToPath({ env: sb.env, platform: 'win32', dir, reg });
  assert.equal(fs.existsSync(path.join(sb.home, '.zshrc')) || fs.existsSync(path.join(sb.home, '.profile')) || fs.existsSync(path.join(sb.home, '.bashrc')), false);
});

test('MEM-040 AC02: the offer asks first and changes nothing when declined', async () => {
  const sb = sandbox(); const rc = path.join(sb.home, '.zshrc'); const env = { ...sb.env, SHELL: '/bin/zsh' };
  assert.equal((await offer({ env, platform: 'linux', ask: async () => 'n' })).declined, true);
  assert.equal(fs.existsSync(rc), false);
  assert.equal(await offer({ env: { ...env, MEMEV_NO_PATH_PROMPT: '1' }, platform: 'linux', ask: async () => 'y' }), null);
  assert.equal(fs.existsSync(rc), false);
  const log = console.log; console.log = () => {};
  try { assert.equal((await offer({ env, platform: 'linux', ask: async () => 'y' })).changed, true); } finally { console.log = log; }
  assert.equal(fs.existsSync(rc), true);
});
