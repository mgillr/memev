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

// Every path under dir, relative, sorted; directories end in /.
function listing(dir) {
  const out = [];
  const walk = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const q = path.join(p, e.name); out.push(path.relative(dir, q) + (e.isDirectory() ? '/' : '')); if (e.isDirectory()) walk(q); } };
  walk(dir);
  return out.sort();
}
function withShim(script, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitshim-'));
  fs.writeFileSync(path.join(dir, 'git'), script, { mode: 0o755 });
  const prev = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${prev}`;
  try { return fn(); } finally { process.env.PATH = prev; }
}

test('MEM-003 AC02: a failed init leaves a folder that already existed exactly as it was, mode included', () => {
  const root = path.join(tmpdir('mem003-'), 'vault');
  fs.mkdirSync(path.join(root, 'my-notes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'my-notes', 'thesis.md'), 'my work\n');
  fs.chmodSync(root, 0o755);
  const before = listing(root);
  withShim('#!/bin/sh\nif [ "$1" = "init" ]; then echo "git: init: boom" >&2; exit 1; fi\nexit 1\n', () => {
    assert.throws(() => initVault(root, { template: path.join(PKG, 'templates', 'vault') }), /git init failed/);
  });
  assert.deepEqual(listing(root), before, 'nothing was added to the folder');
  assert.equal(fs.statSync(root).mode & 0o777, 0o755, 'the folder mode is unchanged');
});

test('MEM-003 AC02: on old git, a failed symbolic-ref leaves no .git behind in a folder that already existed', () => {
  const root = path.join(tmpdir('mem003-'), 'vault');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'a.md'), 'x\n');
  const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  const script = `#!/bin/sh\nfor a in "$@"; do [ "$a" = "-b" ] && { echo "error: unknown switch b" >&2; exit 129; }; done\nfor a in "$@"; do [ "$a" = "symbolic-ref" ] && { echo "symref boom" >&2; exit 1; }; done\nexec ${JSON.stringify(real)} "$@"\n`;
  withShim(script, () => {
    assert.throws(() => initVault(root, { template: path.join(PKG, 'templates', 'vault') }), /git init failed/);
  });
  assert.deepEqual(listing(root), ['a.md'], 'only the file that was there before is left');
});
