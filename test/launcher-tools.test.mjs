// An installer that bundles its own tools (git) passes their folders in MEMEV_TOOLS_PATH. The launcher the core writes puts them
// first on PATH, so the core run by an AI app or the login service, which go through that launcher, uses the bundled tools too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launcherScript, toolsPath, windowsLauncher } from '../src/cli/main.mjs';

const posix = process.platform !== 'win32';
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('the POSIX launcher puts the bundled tools first on PATH for the core it runs', { skip: !posix && 'POSIX launcher' }, () => {
  const dir = tmp('memev-tools-'); const tools = path.join(dir, 'git bin'); fs.mkdirSync(tools);
  const js = path.join(dir, 'probe.mjs'); fs.writeFileSync(js, "console.log(process.env.PATH.split(':')[0]);\n");
  const launcher = path.join(dir, 'memev'); fs.writeFileSync(launcher, launcherScript(process.execPath, js, [tools]), { mode: 0o755 });
  const r = spawnSync(launcher, [], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), tools);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('with no tools the launcher is the same as before', () => {
  assert.equal(launcherScript('/n', '/t'), launcherScript('/n', '/t', []));
  assert.ok(!launcherScript('/n', '/t').includes('bundled'));
  assert.equal(windowsLauncher('C:\\n.exe', 'C:\\t.mjs'), '@"C:\\n.exe" "C:\\t.mjs" %*\r\n');
});

test('the Windows launcher sets PATH inside setlocal, so the caller keeps its own', () => {
  const s = windowsLauncher('C:\\n.exe', 'C:\\t.mjs', ['C:\\Users\\a b\\AppData\\Local\\Programs\\Memev\\resources\\git\\cmd']);
  assert.equal(s, '@setlocal\r\n@set "PATH=C:\\Users\\a b\\AppData\\Local\\Programs\\Memev\\resources\\git\\cmd;%PATH%"\r\n@"C:\\n.exe" "C:\\t.mjs" %*\r\n');
});

test('MEMEV_TOOLS_PATH keeps only absolute folders that exist', () => {
  const dir = tmp('memev-tools-'); const file = path.join(dir, 'f'); fs.writeFileSync(file, '');
  const env = { MEMEV_TOOLS_PATH: [dir, 'relative/x', path.join(dir, 'missing'), file, ''].join(path.delimiter) };
  assert.deepEqual(toolsPath(env), [dir]);
  assert.deepEqual(toolsPath({}), []);
  fs.rmSync(dir, { recursive: true, force: true });
});
