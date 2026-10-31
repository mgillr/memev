// SO-R-A: release gates. I add the CLI smoke script, the CI steps for package validation, smoke
// and container build, and the source-install commands in the docs, and I keep the doc commands
// equal to the workflow's.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { PKG, tmpdir, cleanup } from './helpers/tmp.mjs';

const read = (p) => fs.readFileSync(path.join(PKG, p), 'utf8');

after(cleanup);

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

// The steps of a job, with their run values (comment lines dropped) and any if / continue-on-error.
function jobSteps(job) {
  const steps = [];
  let cur = null;
  let inRun = false;
  const attr = (key, val) => {
    if (!cur) return;
    if (key === 'name') cur.name = val;
    else if (key === 'if') cur.if = val;
    else if (key === 'continue-on-error') cur.continueOnError = val;
    else if (key === 'uses') cur.uses = val;
    else if (key === 'run') {
      if (val === '|' || val === '>' || val === '') inRun = true;
      else cur.run.push(val);
    }
  };
  for (const line of job.split('\n')) {
    const step = /^      - (.*)$/.exec(line);
    if (step) {
      cur = { name: '', run: [], if: null, continueOnError: null, uses: null };
      steps.push(cur);
      inRun = false;
      const a = /^([A-Za-z][A-Za-z0-9-]*):(.*)$/.exec(step[1].trim());
      if (a) attr(a[1], a[2].trim());
      continue;
    }
    if (!cur) continue;
    if (inRun) {
      if (/^ {10,}/.test(line)) {
        const c = line.trim();
        if (c !== '' && !c.startsWith('#')) cur.run.push(c);
        continue;
      }
      inRun = false;
    }
    const a = /^        ([A-Za-z][A-Za-z0-9-]*):(.*)$/.exec(line);
    if (a) attr(a[1], a[2].trim());
  }
  return steps;
}

// A stub memev that fails the one step named in $STUB_FAIL and behaves otherwise.
const STUB_MEMEV = `#!/bin/sh
case "$1" in
  --version)
    if [ "$STUB_FAIL" = version ]; then echo "stub: no version" >&2; exit 1; fi
    echo "0.0.0-stub"
    ;;
  init)
    if [ "$STUB_FAIL" = init ]; then echo "stub: init failed" >&2; exit 1; fi
    ;;
  doctor)
    if [ "$STUB_FAIL" = doctor ]; then echo '[{"name":"stub","status":"fail"}]'; else echo '[{"name":"stub","status":"pass"}]'; fi
    ;;
  status)
    if [ "$STUB_FAIL" = status ]; then echo "stub: status failed" >&2; exit 1; fi
    echo "stub: status ok"
    ;;
esac
exit 0
`;

// The gates in the order the check job must run them.
const GATES = [
  'npm test',
  'node scripts/leak-scan.mjs --history',
  'npm pack --pack-destination /tmp/memev-pack',
  'npm install --prefix /tmp/memev-install /tmp/memev-pack/*.tgz',
  'scripts/smoke.sh /tmp/memev-install/node_modules/.bin/memev',
  'scripts/docker-smoke.sh',
];

function gatesInOrder(runLines) {
  let last = -1;
  for (const cmd of GATES) {
    const idx = runLines.findIndex((l) => l === cmd);
    if (idx < 0 || idx <= last) return false;
    last = idx;
  }
  return true;
}

test('SO-R-A AC01: scripts/smoke.sh passes in a fresh HOME, runs the checkout binary when given one, and names the step when a step fails', () => {
  const script = path.join(PKG, 'scripts', 'smoke.sh');
  assert.ok(fs.existsSync(script), 'scripts/smoke.sh exists');
  // The success path: pass the checkout binary as the argument. A failing memev is first on PATH,
  // so if the script fell back to PATH it would fail; it must use the checkout binary instead.
  const stubDir = tmpdir('ac01-pathstub-');
  const sentinel = path.join(stubDir, 'sentinel');
  fs.writeFileSync(path.join(stubDir, 'memev'), `#!/bin/sh\necho used >> "${sentinel}"\nexit 1\n`, { mode: 0o755 });
  const ok = spawnSync('sh', [script, path.join(PKG, 'bin', 'memev.mjs')], {
    encoding: 'utf8',
    timeout: 180000,
    env: { PATH: `${stubDir}:${process.env.PATH}`, HOME: tmpdir('ac01-home-') },
  });
  assert.equal(ok.status, 0, `smoke failed: ${ok.stdout}\n${ok.stderr}`);
  assert.match(ok.stdout, /smoke: ok/);
  assert.ok(!fs.existsSync(sentinel), 'the checkout binary ran, not the memev first on PATH');
  // The failure path: a stub memev that fails one chosen step, in turn, and the script names it.
  for (const step of ['version', 'init', 'doctor', 'status']) {
    const dir = tmpdir(`ac01-fail-${step}-`);
    const stub = path.join(dir, 'memev');
    fs.writeFileSync(stub, STUB_MEMEV, { mode: 0o755 });
    const r = spawnSync('sh', [script, stub], {
      encoding: 'utf8',
      timeout: 60000,
      env: { PATH: process.env.PATH, HOME: tmpdir(`ac01-failhome-${step}-`), STUB_FAIL: step, MEMEV_EXPECT_VERSION: '0.0.0-stub' },
    });
    assert.notEqual(r.status, 0, `smoke must fail when ${step} is broken`);
    assert.match(`${r.stdout}\n${r.stderr}`, new RegExp(`smoke: FAIL at step ${step}\\b`), `smoke names the ${step} step`);
  }
  // A stub that prints a different version: the version step must fail on the comparison, not just
  // on the exit status.
  {
    const dir = tmpdir('ac01-fail-versiondiff-');
    const stub = path.join(dir, 'memev');
    fs.writeFileSync(stub, STUB_MEMEV, { mode: 0o755 });
    const r = spawnSync('sh', [script, stub], {
      encoding: 'utf8',
      timeout: 60000,
      env: { PATH: process.env.PATH, HOME: tmpdir('ac01-failhome-versiondiff-'), STUB_FAIL: '' },
    });
    assert.notEqual(r.status, 0, 'smoke must fail when the printed version differs');
    assert.match(`${r.stdout}\n${r.stderr}`, /smoke: FAIL at step version\b/, 'smoke names the version step when the version differs');
  }
  // The AC's failure path names a stub node on PATH: with a broken node, the port step fails.
  {
    const dir = tmpdir('ac01-nodestub-');
    fs.writeFileSync(path.join(dir, 'node'), '#!/bin/sh\necho "stub node" >&2\nexit 1\n', { mode: 0o755 });
    const r = spawnSync('sh', [script, path.join(PKG, 'bin', 'memev.mjs')], {
      encoding: 'utf8',
      timeout: 60000,
      env: { PATH: `${dir}:${process.env.PATH}`, HOME: tmpdir('ac01-nodehome-') },
    });
    assert.notEqual(r.status, 0, 'smoke must fail when node on PATH is broken');
    assert.match(`${r.stdout}\n${r.stderr}`, /smoke: FAIL at step port\b/, 'smoke names the port step when node is broken');
  }
});

test('SO-R-A AC02: the pull-request job runs the suite, leak scan, pack-install-smoke and docker smoke in order, on Linux only, with no dependency install and no secret', () => {
  const wf = read('.github/workflows/ci.yml');
  const job = checkJob();
  const steps = jobSteps(job);
  const runLines = steps.flatMap((s) => s.run);
  // The gates, in order, taken from the run values only. Each gate line must be the command,
  // not a string that merely contains it, so "npm test || true" does not count.
  assert.ok(gatesInOrder(runLines), 'the check job runs the gates in order');
  // The job itself may not be allowed to fail.
  assert.ok(!/^    continue-on-error:/m.test(job), 'the check job has no job-level continue-on-error');
  // The container build lives in the docker smoke, which the check job runs. A comment does not
  // count: the line must be a real docker build or docker compose build, called directly or through
  // the script's own compose wrapper (dc() { docker compose ... }). The job names no image to pull,
  // so the smoke takes its build branch in CI.
  const smoke = read('scripts/docker-smoke.sh');
  const viaWrapper = /^\s*dc\(\)\s*\{\s*docker compose\b/m.test(smoke) && /^\s*dc build\b/m.test(smoke);
  assert.ok(/^\s*docker (compose )?build\b/m.test(smoke) || viaWrapper, 'scripts/docker-smoke.sh builds the container image');
  assert.ok(!/MEMEV_IMAGE/.test(job), 'the check job names no image to pull, so the docker smoke builds it');
  // No step that runs a gate is skipped or allowed to fail: no if, no continue-on-error.
  for (const s of steps) {
    const gate = s.run.find((l) => GATES.includes(l));
    if (gate !== undefined) {
      assert.equal(s.if, null, `the step running ${gate} has no if: condition`);
      assert.equal(s.continueOnError, null, `the step running ${gate} has no continue-on-error`);
    }
  }
  // Control: deleting the docker-smoke line must fail the order check.
  const mutated = job.replace('run: scripts/docker-smoke.sh', 'run: scripts/no-such-smoke.sh');
  assert.notEqual(mutated, job, 'the control changed the workflow');
  assert.ok(!gatesInOrder(jobSteps(mutated).flatMap((s) => s.run)), 'the order check fails when the docker-smoke line is deleted');
  // The Linux job only, on pull requests.
  assert.match(job, /runs-on: ubuntu-latest/);
  assert.match(job, /if: github\.event_name == 'pull_request'/);
  const win = windowsJob();
  for (const cmd of ['npm pack', 'scripts/smoke.sh', 'docker build', 'scripts/docker-smoke.sh']) {
    assert.ok(!win.includes(cmd), `the Windows job does not run ${cmd}`);
  }
  // No dependency install: the only npm install in the run values is the one from the packed
  // tarball.
  for (const l of runLines) {
    if (/npm (install|ci|i)\b/.test(l)) {
      assert.match(l, /^npm install --prefix .*\.tgz$/, `no dependency install in the workflow: ${l}`);
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
  const mkdirCmd = cmds.find((c) => c.startsWith('mkdir -p'));
  const packCmd = cmds.find((c) => c.startsWith('npm pack'));
  const install = cmds.find((c) => c.startsWith('npm install'));
  const run = cmds.find((c) => c.startsWith('scripts/smoke.sh'));
  for (const [name, c] of [['clone', clone], ['test', testCmd], ['mkdir', mkdirCmd], ['pack', packCmd], ['install', install], ['run', run]]) {
    assert.ok(c, `the section has a ${name} command`);
  }
  // Compared as strings: the workflow runs the same commands.
  const job = checkJob();
  assert.ok(job.includes('actions/checkout@v4'), 'the workflow clones with actions/checkout');
  for (const c of [testCmd, mkdirCmd, packCmd, install, run]) {
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
  // The allowed set is pinned to the release list, not derived from package.json "files": adding
  // scripts/ or .github/ to files must fail this test. It is the tracked files under those entries
  // (git ls-files), so an untracked local file is neither allowed nor packed, and a local file npm
  // would pack fails the comparison.
  const TOP = ['bin', 'src', 'templates', 'vendor', 'docs', 'LICENSE', 'NOTICE', 'README.md', 'SECURITY.md', 'CHARTER.md'];
  const EXCLUDE = new Set(['docs/BENCH.md']);
  const allowed = new Set(['package.json']);
  const tracked = execFileSync('git', ['ls-files'], { cwd: PKG, encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const f of tracked) {
    const top = f.split('/')[0];
    if (TOP.includes(top) && !EXCLUDE.has(f)) allowed.add(f);
  }
  const dryRaw = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: PKG, encoding: 'utf8', maxBuffer: 1 << 30 });
  const dry = JSON.parse(dryRaw);
  const packList = (Array.isArray(dry) ? dry[0] : dry).files.map((f) => f.path).sort();
  assert.deepEqual(packList, [...allowed].sort(), 'npm pack carries exactly the pinned release set');
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
