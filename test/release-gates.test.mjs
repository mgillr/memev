// SO-R-A: release gates. I add the CLI smoke script, the CI steps for package validation, smoke
// and container build, and the source-install commands in the docs, and I keep the doc commands
// equal to the workflow's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { PKG, tmpdir } from './helpers/tmp.mjs';

const read = (p) => fs.readFileSync(path.join(PKG, p), 'utf8');

// The check job of the CI workflow: from "  check:" to the next job at the same indent.
function checkJob() {
  const lines = read('.github/workflows/ci.yml').split('\n');
  const start = lines.findIndex((l) => /^  check:/.test(l));
  assert.ok(start >= 0, 'the workflow has a check job');
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^  [a-z0-9-]+:/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

function windowsJob() {
  const lines = read('.github/workflows/ci.yml').split('\n');
  const start = lines.findIndex((l) => /^  windows:/.test(l));
  assert.ok(start >= 0, 'the workflow has a windows job');
  return lines.slice(start).join('\n');
}

test('SO-R-A AC01: scripts/smoke.sh passes in a fresh HOME and names the step when a step fails', () => {
  const script = path.join(PKG, 'scripts', 'smoke.sh');
  assert.ok(fs.existsSync(script), 'scripts/smoke.sh exists');
  // The success path: the script makes its own fresh HOME and takes its port from the operating
  // system, so the test only gives it a controlled environment.
  const ok = spawnSync('sh', [script], {
    encoding: 'utf8',
    timeout: 180000,
    env: { PATH: process.env.PATH, HOME: tmpdir('smoke-home-') },
  });
  assert.equal(ok.status, 0, `smoke failed: ${ok.stdout}\n${ok.stderr}`);
  assert.match(ok.stdout, /smoke: ok/);
  // The failure path: a stub node on PATH breaks the first node step, and the script names it.
  const stub = tmpdir('stub-node-');
  fs.writeFileSync(path.join(stub, 'node'), '#!/bin/sh\necho stub node >&2\nexit 1\n', { mode: 0o755 });
  const bad = spawnSync('sh', [script], {
    encoding: 'utf8',
    timeout: 60000,
    env: { PATH: `${stub}:${process.env.PATH}`, HOME: tmpdir('smoke-home-') },
  });
  assert.notEqual(bad.status, 0, 'the smoke must fail with a broken step');
  assert.match(bad.stderr, /smoke: FAIL at step \w+/);
});

test('SO-R-A AC02: the pull-request job runs the suite, leak scan, pack-install-smoke and container build in order, on Linux only, with no dependency install and no secret', () => {
  const wf = read('.github/workflows/ci.yml');
  const job = checkJob();
  // The order: full suite, leak scan with --history, pack, install from the packed tarball, smoke,
  // container build, docker smoke.
  const order = [
    'npm test',
    'node scripts/leak-scan.mjs --history',
    'npm pack --pack-destination /tmp/memev-pack',
    'npm install --prefix /tmp/memev-install /tmp/memev-pack/*.tgz',
    'scripts/smoke.sh /tmp/memev-install/node_modules/.bin/memev',
    'docker build -t memev:local .',
    'scripts/docker-smoke.sh',
  ];
  let prev = -1;
  for (const cmd of order) {
    const idx = job.indexOf(cmd);
    assert.ok(idx > prev, `the check job runs ${cmd} after the previous step`);
    prev = idx;
  }
  // The Linux job only, on pull requests.
  assert.match(job, /runs-on: ubuntu-latest/);
  assert.match(job, /if: github\.event_name == 'pull_request'/);
  const win = windowsJob();
  for (const cmd of ['npm pack', 'scripts/smoke.sh', 'docker build', 'scripts/docker-smoke.sh']) {
    assert.ok(!win.includes(cmd), `the Windows job does not run ${cmd}`);
  }
  // No dependency install: the only npm install in the workflow is the one from the packed
  // tarball.
  for (const line of wf.split('\n')) {
    if (/npm (install|ci|i)\b/.test(line)) {
      assert.match(line.trim(), /^npm install --prefix .*\.tgz$/, `no dependency install in the workflow: ${line.trim()}`);
    }
  }
  // No secret other than the built-in token.
  for (const m of wf.matchAll(/secrets\.([A-Z_]+)/g)) {
    assert.equal(m[1], 'GITHUB_TOKEN', 'the only secret is the built-in token');
  }
});

test('SO-R-A AC03: the source-install commands in docs/DEVELOPING.md are the workflow\'s commands and run from a clean export of HEAD', () => {
  const doc = read('docs/DEVELOPING.md');
  const m = /## Install from source\n([\s\S]*?)```sh\n([\s\S]*?)```/.exec(doc);
  assert.ok(m, 'docs/DEVELOPING.md has an Install from source section with a fenced sh block');
  const cmds = m[2].split('\n').map((l) => l.trim()).filter(Boolean);
  const clone = cmds.find((c) => c.startsWith('git clone'));
  const testCmd = cmds.find((c) => c === 'npm test');
  const install = cmds.find((c) => c.startsWith('npm install'));
  const run = cmds.find((c) => c.startsWith('scripts/smoke.sh'));
  for (const [name, c] of [['clone', clone], ['test', testCmd], ['install', install], ['run', run]]) {
    assert.ok(c, `the section has a ${name} command`);
  }
  // Compared as strings: the workflow runs the same commands.
  const job = checkJob();
  assert.ok(job.includes('actions/checkout@v4'), 'the workflow clones with actions/checkout');
  for (const c of [testCmd, install, run]) {
    assert.ok(job.includes(c), `the workflow runs exactly: ${c}`);
  }
  // And the clean-checkout path: export HEAD, run the commands there, through scripts/smoke.sh.
  // The export stands in for the clone; npm test is the suite that is running this test, so the
  // export runs the install and the run.
  const scratch = tmpdir('clean-scratch-');
  const tar = path.join(scratch, 'head.tar');
  execFileSync('git', ['archive', 'HEAD', '-o', tar], { cwd: PKG });
  const clean = tmpdir('clean-checkout-');
  execFileSync('tar', ['-x', '-f', tar, '-C', clean]);
  const packDir = tmpdir('clean-pack-');
  const installDir = tmpdir('clean-install-');
  const steps = cmds
    .filter((c) => !c.startsWith('git clone') && c !== 'cd memev' && c !== 'npm test')
    .map((c) => c.replace('/tmp/memev-pack', packDir).replace('/tmp/memev-install', installDir));
  const r = spawnSync('sh', ['-c', steps.join('\n')], {
    cwd: clean,
    encoding: 'utf8',
    timeout: 180000,
    env: { PATH: process.env.PATH, HOME: tmpdir('clean-home-') },
  });
  assert.equal(r.status, 0, `clean-checkout install failed: ${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /smoke: ok/);
});

test('SO-R-A AC04: the runtime pins hold: engines.node at 22 or newer, no dependencies, no lockfile, one pinned runtime', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.engines && typeof pkg.engines.node === 'string', 'engines.node is declared');
  const m = /^>=\s*(\d+)$/.exec(pkg.engines.node);
  assert.ok(m && Number(m[1]) >= 22, `engines.node is 22 or newer: ${pkg.engines.node}`);
  assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0, 'no dependencies');
  assert.ok(!pkg.devDependencies || Object.keys(pkg.devDependencies).length === 0, 'no devDependencies');
  const tracked = execFileSync('git', ['ls-files'], { cwd: PKG, encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const lock of ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb']) {
    assert.ok(!tracked.includes(lock), `no ${lock} is tracked`);
  }
  const rt = JSON.parse(read('scripts/node-runtime.json'));
  assert.match(String(rt.version), /^\d+\.\d+\.\d+$/, 'scripts/node-runtime.json pins one Node version');
});

test('SO-R-A AC05: npm pack and the release tarball carry the allowed set and nothing private', () => {
  const pkg = JSON.parse(read('package.json'));
  // The allowed set: what package.json "files" names, plus package.json, which npm always ships.
  const allowed = new Set(['package.json']);
  const excludes = pkg.files.filter((f) => f.startsWith('!')).map((f) => f.slice(1).replace(/\/$/, ''));
  const isExcluded = (p) => excludes.some((e) => p === e || p.startsWith(e + '/'));
  const walk = (dir) => {
    let out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      out = e.isDirectory() ? out.concat(walk(p)) : out.concat(p);
    }
    return out;
  };
  for (const f of pkg.files) {
    if (f.startsWith('!')) continue;
    const p = f.replace(/\/$/, '');
    if (fs.statSync(path.join(PKG, p)).isDirectory()) {
      for (const abs of walk(path.join(PKG, p))) {
        const rel = path.relative(PKG, abs).split(path.sep).join('/');
        if (!isExcluded(rel)) allowed.add(rel);
      }
    } else {
      allowed.add(p);
    }
  }
  const dryRaw = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: PKG, encoding: 'utf8', maxBuffer: 1 << 30 });
  const dry = JSON.parse(dryRaw);
  const packList = (Array.isArray(dry) ? dry[0] : dry).files.map((f) => f.path).sort();
  assert.deepEqual(packList, [...allowed].sort(), 'npm pack carries exactly the allowed set');
  const out = tmpdir('release-tarball-');
  execFileSync('node', ['scripts/release-tarball.mjs', '--out', out], { cwd: PKG, encoding: 'utf8' });
  const tgz = fs.readdirSync(out).find((f) => f.endsWith('.tgz'));
  const tarList = execFileSync('tar', ['-tzf', path.join(out, tgz)], { encoding: 'utf8' })
    .split('\n')
    .filter((l) => l && !l.endsWith('/'))
    .map((l) => l.replace(/^package\//, ''))
    .sort();
  assert.deepEqual(tarList, [...allowed].sort(), 'the release tarball carries the same list');
  // Nothing private ships: no .env, keys, credentials, vault folder, test fixtures or local
  // config.
  const privateRe = [
    /(^|\/)\.env(\..+)?$/,
    /(^|\/)\.memev(\/|$)/,
    /\.pem$|\.key$|\.p12$|\.pfx$|id_rsa|private-key/i,
    /credential|\.netrc|admin\.json|secrets\.json/i,
    /^test\/|fixture/i,
    /\.local\.(json|ya?ml)$|\.npmrc$|package-lock\.json/i,
  ];
  for (const f of packList) {
    for (const re of privateRe) assert.ok(!re.test(f), `${f} is private`);
  }
});
