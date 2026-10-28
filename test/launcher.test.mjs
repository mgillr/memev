// The launcher survives a Node upgrade: it runs node from PATH when that is Node 22 or newer, and the Node recorded at
// install otherwise. When neither is there, it says so, and doctor fails its launcher check with the fix.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sandbox, BIN } from './helpers/cli.mjs';
import { tmpdir, cleanup } from './helpers/tmp.mjs';
import { fixFor } from '../src/cli/preflight.mjs';
import { installRuntime } from '../src/cli/main.mjs';

after(() => cleanup());
const posix = process.platform !== 'win32';
const launcherOf = (sb) => path.join(sb.env.MEMEV_CONFIG_DIR, 'bin', 'memev');
const launch = (sb, PATH, args = ['help']) => spawnSync(launcherOf(sb), args, { env: { ...sb.env, PATH }, encoding: 'utf8', timeout: 30000 });
// a folder holding only this command, linked to the real one
const only = (name) => {
  const real = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  const d = tmpdir(`only-${name}-`); fs.symlinkSync(real, path.join(d, name)); return d;
};
// a node that is its own file, as an install by nvm, fnm, Volta or a Homebrew Cellar leaves it, so it can be deleted
function ownNode() {
  const d = tmpdir('oldnode-'); const f = path.join(d, 'node');
  try { fs.linkSync(process.execPath, f); } catch { fs.copyFileSync(process.execPath, f); fs.chmodSync(f, 0o755); }
  return { dir: d, node: f };
}
// init run by that node, then that node deleted, as an upgrade does
function initThenUpgrade(sb) {
  const old = ownNode();
  const r = spawnSync(old.node, [BIN, 'init', '--port', String(sb.port), '--local-only', '--no-connect'], { env: { ...sb.env, PATH: old.dir + path.delimiter + sb.env.PATH }, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(fs.readFileSync(launcherOf(sb), 'utf8'), new RegExp(`^REC='${old.node.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'$`, 'm'), 'the launcher recorded the Node that ran init');
  sb.stop();
  fs.rmSync(old.dir, { recursive: true, force: true });
  return old;
}
// a node on PATH that reports a version and leaves a mark when it runs Memev
function fakeNode(version, { runs = false } = {}) {
  const d = tmpdir(`node${version}-`);
  fs.writeFileSync(path.join(d, 'node'), `#!/bin/sh\nif [ "$1" = --version ]; then echo v${version}.0.0; exit 0; fi\necho "node ${version} ran" >&2\n${runs ? `exec '${process.execPath}' "$@"` : 'exit 3'}\n`, { mode: 0o755 });
  return d;
}

test('after the Node that ran init is deleted, the launcher runs Memev with node from PATH', { skip: !posix && 'POSIX launcher' }, () => {
  const sb = sandbox();
  try {
    initThenUpgrade(sb);
    const r = launch(sb, sb.env.PATH);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^memev \S+: one memory/);
    const doc = sb.run(['doctor']);
    assert.match(doc.out, /✓ stable launcher installed: .* runs .*node \(v\d+\.\d+\.\d+\), found on PATH/, doc.out);
  } finally { sb.stop(); }
});

test('MEM-007 AC03: the launcher refuses a PATH node older than 22 and uses the recorded path', { skip: !posix && 'POSIX launcher' }, () => {
  const sb = sandbox();
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
    sb.stop();
    const old = launch(sb, fakeNode(20) + path.delimiter + sb.env.PATH);
    assert.equal(old.status, 0, old.stdout + old.stderr);
    assert.match(old.stdout, /^memev \S+: one memory/);
    assert.doesNotMatch(old.stderr, /node 20 ran/, 'Node 20 on PATH was not used');
    // a newer one on PATH is used first
    const newer = launch(sb, fakeNode(24, { runs: true }) + path.delimiter + sb.env.PATH);
    assert.equal(newer.status, 0, newer.stdout + newer.stderr);
    assert.match(newer.stderr, /node 24 ran/, 'Node 24 on PATH was used');
  } finally { sb.stop(); }
});

test("MEM-007 AC02: doctor fails the launcher check with the fix when neither node on PATH nor the recorded Node exists, and --fix repairs it", { skip: !posix && 'POSIX launcher' }, () => {
  const sb = sandbox();
  try {
    const old = initThenUpgrade(sb);
    const noNode = only('git'); // git is there, node is not
    const r = launch(sb, noNode);
    assert.equal(r.status, 127, r.stdout + r.stderr);
    assert.match(r.stderr, /no Node\.js 22 or newer: .* is gone\. Install Node\.js 22 or newer, then run: node ".*memev\.mjs" doctor --fix/);
    assert.equal(sb.run(['start']).code, 0, 'the daemon itself is started by the Node running this test');
    const doc = sb.run(['doctor'], { extraEnv: { PATH: noNode } });
    assert.equal(doc.code, 1, doc.out);
    assert.ok(doc.out.includes(`✗ stable launcher installed: ${launcherOf(sb)} finds no Node.js 22 or newer: no node on PATH, and the recorded ${old.node} is gone`), doc.out);
    assert.ok(doc.out.includes(`fix: ${fixFor('node', process.platform)} Then run memev doctor --fix to point the launcher at it.`), doc.out);
    assert.deepEqual(doc.out.split('\n').filter((l) => l.includes('✗')).map((l) => l.trim().split(':')[0]), ['✗ stable launcher installed'], 'the launcher is the only failing check');
    // the fix (what doctor --fix runs for this check, without its other fixes such as the login service): with a Node
    // installed again, here the one running this test, the launcher is pointed at it and runs with no node on PATH
    installRuntime({ ...sb.env, PATH: noNode });
    assert.match(sb.run(['doctor'], { extraEnv: { PATH: noNode } }).out, /✓ stable launcher installed: .* runs /);
    sb.stop();
    assert.equal(launch(sb, noNode).status, 0, 'the launcher runs again with no node on PATH');
  } finally { sb.stop(); }
});

test('the launcher records Node by its name on PATH when that name is this Node, so a link an upgrade moves keeps working', { skip: !posix && 'POSIX launcher' }, () => {
  const sb = sandbox();
  const link = tmpdir('nodelink-'); fs.symlinkSync(process.execPath, path.join(link, 'node'));
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect'], { extraEnv: { PATH: link + path.delimiter + sb.env.PATH } }).code, 0);
    assert.match(fs.readFileSync(launcherOf(sb), 'utf8'), new RegExp(`^REC='${path.join(link, 'node').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'$`, 'm'));
    // when the first node on PATH is another Node, the binary that ran init is recorded
    sb.stop();
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect'], { extraEnv: { PATH: fakeNode(20) + path.delimiter + sb.env.PATH } }).code, 0);
    assert.match(fs.readFileSync(launcherOf(sb), 'utf8'), new RegExp(`^REC='${process.execPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'$`, 'm'));
  } finally { sb.stop(); }
});
