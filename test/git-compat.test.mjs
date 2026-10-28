import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initVault } from '../src/engine/vault.mjs';
import { git } from '../src/engine/git.mjs';
import { tmpdir, cleanup } from './helpers/tmp.mjs';
after(cleanup);

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A git shim that behaves like git before 2.28: it rejects the -b flag on init.
function oldGitShim() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitshim-'));
  const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  const sh = `#!/bin/sh
if [ "$1" = "init" ]; then
  for a in "$@"; do
    if [ "$a" = "-b" ]; then
      echo "error: unknown switch -b" >&2
      exit 129
    fi
  done
fi
exec ${JSON.stringify(real)} "$@"
`;
  fs.writeFileSync(path.join(dir, 'git'), sh, { mode: 0o755 });
  return dir;
}

test('MEM-003 AC01: with a git shim that rejects -b, the vault is still created with HEAD on refs/heads/main', () => {
  const shim = oldGitShim();
  const root = path.join(tmpdir(), 'vault');
  const prev = process.env.PATH;
  process.env.PATH = `${shim}:${prev}`;
  try {
    initVault(root, { template: path.join(PKG, 'templates', 'vault') });
  } finally {
    process.env.PATH = prev;
  }
  assert.ok(fs.existsSync(path.join(root, '.git')), 'the vault has a git repo');
  assert.equal(git(root, ['symbolic-ref', 'HEAD']).out, 'refs/heads/main');
});

test('MEM-003 AC02: when git init fails outright, init stops with a message naming git and the vault is not left half built', () => {
  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'gitshim-'));
  fs.writeFileSync(path.join(shim, 'git'), '#!/bin/sh\nif [ "$1" = "init" ]; then echo "git: init: boom" >&2; exit 1; fi\nexec /usr/bin/false\n', { mode: 0o755 });
  const root = path.join(tmpdir(), 'vault');
  const prev = process.env.PATH;
  process.env.PATH = `${shim}:${prev}`;
  try {
    assert.throws(() => initVault(root, { template: path.join(PKG, 'templates', 'vault') }), /git/);
  } finally {
    process.env.PATH = prev;
  }
  assert.ok(!fs.existsSync(path.join(root, '.git')), 'no half built git repo is left behind');
});

test('MEM-003 AC02: when git init fails on a folder that already has files, the files that were there before are not removed', () => {
  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'gitshim-'));
  fs.writeFileSync(path.join(shim, 'git'), '#!/bin/sh\nif [ "$1" = "init" ]; then echo "git: init: boom" >&2; exit 1; fi\nexec /usr/bin/false\n', { mode: 0o755 });
  const root = path.join(tmpdir(), 'vault');
  fs.mkdirSync(path.join(root, 'my-notes', 'projects'), { recursive: true });
  const kept = path.join(root, 'my-notes', 'projects', 'thesis.md');
  fs.writeFileSync(kept, 'my work\n');
  const prev = process.env.PATH;
  process.env.PATH = `${shim}:${prev}`;
  try {
    assert.throws(() => initVault(root, { template: path.join(PKG, 'templates', 'vault') }), /git/);
  } finally {
    process.env.PATH = prev;
  }
  assert.ok(fs.existsSync(root), 'the folder that existed before the call is still there');
  assert.equal(fs.readFileSync(kept, 'utf8'), 'my work\n', 'the file that was there before is still there');
  assert.ok(!fs.existsSync(path.join(root, '.git')), 'no half built git repo is left behind');
});
