// The tag-triggered release build: .github/workflows/release.yml fires on a v* tag, runs the full
// test suite and the leak scan, checks the tag against package.json, builds the tarball and its
// SHA-256 file, and attaches both to the release. It publishes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WF = path.join(root, '.github', 'workflows', 'release.yml');
const wfText = () => fs.readFileSync(WF, 'utf8');
const pkg = () => JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// A small line-based reader for the one workflow this test owns: the trigger block under `on:`
// and the job steps in order, with block scalars folded into their key.
function parseWorkflow(text) {
  const lines = text.split('\n');
  const on = lines.findIndex((l) => /^on:\s*$/.test(l));
  assert.ok(on >= 0, 'the workflow has an on: trigger block');
  const triggers = [];
  for (let j = on + 1; j < lines.length; j++) {
    if (/^\S/.test(lines[j])) break;
    triggers.push(lines[j]);
  }
  const steps = [];
  let inSteps = false;
  let cur = null;
  let block = null;
  for (const line of lines) {
    if (/^    steps:\s*$/.test(line)) { inSteps = true; continue; }
    if (!inSteps) continue;
    const step = line.match(/^      - (\w+):\s*(.*)$/);
    if (step) {
      if (cur) steps.push(cur);
      cur = { [step[1]]: step[2] };
      block = null;
      continue;
    }
    if (!cur) continue;
    const field = line.match(/^        (\w+):\s*(.*)$/);
    if (field) {
      cur[field[1]] = field[2];
      block = field[2] === '|' || field[2] === '>' ? field[1] : null;
      continue;
    }
    const body = line.match(/^          (.*)$/);
    if (body && block) {
      cur[block] = (cur[block] || '') + body[1] + '\n';
      continue;
    }
    if (/^\S/.test(line)) inSteps = false;
  }
  if (cur) steps.push(cur);
  return { triggers, steps };
}

const idx = (steps, pred) => steps.findIndex(pred);
// The job names under the top-level jobs: key.
const jobsOf = (text) => {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  const out = [];
  for (let j = at + 1; at >= 0 && j < lines.length && !/^\S/.test(lines[j]); j++) {
    const m = lines[j].match(/^  ([\w-]+):\s*$/);
    if (m) out.push(m[1]);
  }
  return out;
};
const runOf = (s) => (s.run || '') + ' ' + (s.uses || '');

test('WO-01-A AC01: the release workflow runs only on a v* tag push, its steps are the test suite, the leak scan, the tag check, the tarball build and the attachment in order, and it installs no dependency', () => {
  const { triggers, steps } = parseWorkflow(wfText());
  const trig = triggers.join('\n');
  assert.match(trig, /^  push:\n    tags: \['v\*'\]$/, 'the only trigger is a push of a v* tag');
  assert.doesNotMatch(trig, /pull_request|workflow_dispatch|schedule|branches|workflow_call|release/);
  assert.ok(steps.length >= 5, 'the job has its steps');
  const iTest = idx(steps, (s) => (s.run || '').trim() === 'npm test');
  const iLeak = idx(steps, (s) => (s.run || '').includes('node scripts/leak-scan.mjs --history'));
  const iTag = idx(steps, (s) => (s.run || '').includes('node scripts/release-tag-check.mjs'));
  const iBuild = idx(steps, (s) => (s.run || '').includes('node scripts/release-tarball.mjs'));
  const iAttach = idx(steps, (s) => (s.run || '').includes('gh release upload') && (s.run || '').includes('.sha256'));
  for (const [name, i] of [['test suite', iTest], ['leak scan', iLeak], ['tag check', iTag], ['tarball build', iBuild], ['attachment', iAttach]]) {
    assert.ok(i >= 0, `the workflow has a ${name} step`);
  }
  assert.ok(iTest < iLeak && iLeak < iTag && iTag < iBuild && iBuild < iAttach,
    `steps in order: test(${iTest}) leak(${iLeak}) tag(${iTag}) build(${iBuild}) attach(${iAttach})`);
  const attach = steps[iAttach].run;
  assert.match(attach, /dist\/\*\.tgz/, 'the attachment names the tarball');
  assert.match(attach, /dist\/\*\.tgz\.sha256/, 'the attachment names the .sha256 file beside it');
  for (const s of steps) {
    assert.doesNotMatch(runOf(s), /\bnpm (install|ci|i)\b/, 'no dependency install: ' + runOf(s));
    assert.doesNotMatch(runOf(s), /\b(yarn|pnpm)\b/, 'no other package installer: ' + runOf(s));
  }
  const p = pkg();
  assert.ok(!('dependencies' in p) && !('devDependencies' in p) && !('optionalDependencies' in p) && !('peerDependencies' in p),
    'the repository still declares no dependency');
});

test('WO-01-A AC01: one job, nothing is released before the leak scan, and no step can be skipped or have its failure ignored', () => {
  const text = wfText();
  assert.deepEqual(jobsOf(text).length, 1, 'the workflow has one job, so nothing runs beside the checked steps');
  const { steps } = parseWorkflow(text);
  const iLeak = idx(steps, (s) => (s.run || '').includes('node scripts/leak-scan.mjs --history'));
  assert.ok(iLeak > 0, 'the workflow has a leak scan step');
  for (const s of steps.slice(0, iLeak)) {
    assert.doesNotMatch((s.name || '') + ' ' + runOf(s), /gh release|release-action|action-gh-release|upload-artifact/i, 'nothing is released before the leak scan: ' + (s.name || runOf(s)));
  }
  assert.doesNotMatch(text, /^\s*(continue-on-error|if):/m, 'no step or job is conditional or allowed to fail');
  for (const s of steps) {
    assert.doesNotMatch(s.run || '', /\|\|\s*(true|:|exit 0)\b/, 'no step swallows a failure: ' + (s.name || s.run));
  }
});

test('WO-01-A AC01: a local dry run of the workflow scripts passes: the leak scan is clean, the tag check exits 0 and the tarball build writes a matching .sha256', () => {
  const version = pkg().version;
  const leak = spawnSync(process.execPath, ['scripts/leak-scan.mjs', '--history'], { cwd: root, encoding: 'utf8' });
  assert.equal(leak.status, 0, leak.stderr);
  const tag = spawnSync(process.execPath, ['scripts/release-tag-check.mjs', 'v' + version], { cwd: root, encoding: 'utf8' });
  assert.equal(tag.status, 0, tag.stderr);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-wo01a-'));
  try {
    const build = spawnSync(process.execPath, ['scripts/release-tarball.mjs', '--out', out], { cwd: root, encoding: 'utf8' });
    assert.equal(build.status, 0, build.stderr);
    const names = fs.readdirSync(out).filter((f) => f.endsWith('.tgz'));
    assert.equal(names.length, 1, names.join(','));
    const sum = fs.readFileSync(path.join(out, names[0] + '.sha256'), 'utf8').trim().split(/\s+/)[0];
    const hash = createHash('sha256').update(fs.readFileSync(path.join(out, names[0]))).digest('hex');
    assert.equal(sum, hash, 'the .sha256 file matches the tarball');
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('WO-01-A AC02: the workflow publishes nothing by itself: no publish step and no registry credential', () => {
  const { steps } = parseWorkflow(wfText());
  for (const s of steps) {
    assert.doesNotMatch((s.name || '') + ' ' + runOf(s), /\bpublish/i, 'no publish step: ' + (s.name || s.run));
  }
  const text = wfText();
  assert.doesNotMatch(text, /npm publish/);
  assert.doesNotMatch(text, /NPM_TOKEN|NODE_AUTH_TOKEN|npm_token/);
  assert.doesNotMatch(text, /registry[\s-]*token|token[\s-]*registry/i);
  const secrets = [...text.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]);
  assert.ok(secrets.length > 0 && secrets.every((n) => n === 'GITHUB_TOKEN'), 'the only secret is the default token: ' + secrets.join(', '));
  assert.match(text, /^permissions:\n  contents: write\n(?! )/m, 'permissions are exactly contents: write');
  assert.equal((text.match(/^\s*permissions:/gm) || []).length, 1, 'no job widens the permissions');
  assert.match(text, /- uses: actions\/checkout@v4\n        with:\n(?:          .*\n)*?          persist-credentials: false\n/, 'the checkout keeps no token in .git/config');
});

test('WO-01-A AC03: release-tag-check.mjs exits 0 on a tag that matches the version and non-zero on one that does not, and the workflow runs it', () => {
  const version = pkg().version;
  const ok = spawnSync(process.execPath, ['scripts/release-tag-check.mjs', 'v' + version], { cwd: root, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const major = Number(version.split('.')[0]);
  for (const bad of [`v${major + 1}.0.0`, version, 'v' + version + '-rc.1']) {
    const no = spawnSync(process.execPath, ['scripts/release-tag-check.mjs', bad], { cwd: root, encoding: 'utf8' });
    assert.notEqual(no.status, 0, `tag ${bad} must not pass`);
  }
  const none = spawnSync(process.execPath, ['scripts/release-tag-check.mjs'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(none.status, 0, 'a missing tag is an error');
  const { steps } = parseWorkflow(wfText());
  const iTag = idx(steps, (s) => (s.run || '').includes('node scripts/release-tag-check.mjs'));
  assert.ok(iTag >= 0, 'the workflow runs the tag check');
  assert.equal(steps[iTag].run.trim(), 'node scripts/release-tag-check.mjs "${GITHUB_REF_NAME}"', 'the tag check gets the tag from the environment, exactly');
  for (const s of steps) {
    assert.doesNotMatch(s.run || '', /\$\{\{/, 'no run line pastes an expression into the shell: ' + (s.name || s.run));
  }
});
