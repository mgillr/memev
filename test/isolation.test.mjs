import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PKG } from './helpers/tmp.mjs';

const git = (...a) => { try { return execFileSync('git', a, { cwd: PKG, encoding: 'utf8' }).trim(); } catch { return null; } };

test('no runtime dependencies and no install scripts', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'));
  assert.equal(Object.keys(pkg.dependencies || {}).length, 0);
  assert.equal(pkg.scripts?.postinstall, undefined);
  assert.equal(pkg.scripts?.preinstall, undefined);
});

test('no submodules, subtrees or foreign remotes', { skip: git('rev-parse', '--git-dir') === null }, () => {
  assert.equal(fs.existsSync(path.join(PKG, '.gitmodules')), false);
  const subtree = git('log', '--all', '--format=%B', '--grep=git-subtree-dir') || '';
  assert.equal(subtree, '');
  for (const url of (git('remote', '-v') || '').split('\n').filter(Boolean).map((l) => l.split(/\s+/)[1])) assert.match(url, /[/:][^/]+\/memev(\.git)?$/);
  const roots = (git('rev-list', '--max-parents=0', 'HEAD') || '').split('\n').filter(Boolean);
  assert.ok(roots.length <= 1, 'one root commit');
});

test('the product code does not phone home', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(PKG, 'src'))) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) assert.ok(/^(127\.0\.0\.1|localhost|github\.com|api\.github\.com|pkgs\.tailscale\.com|tailscale\.com|developers\.cloudflare\.com|www\.apple\.com|cli\.github\.com)$/.test(m[1]) || m[1].includes('${'), `${path.relative(PKG, f)} names ${m[1]}`);
  }
});
