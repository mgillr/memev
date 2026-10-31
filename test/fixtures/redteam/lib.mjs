// SPDX-License-Identifier: Apache-2.0
// Helpers for the red-team gate tests and fixtures. The signer here is written from the record format in
// docs/CONTRACTS.md, apart from the gate's own code, so a test signs the way a reviewer would and the gate
// has to agree. No private key is committed (scripts/leak-scan.mjs refuses one): the committed fixture
// trees were signed once with a throwaway key whose public half is reviewer.pub, and the tests sign with a
// key made for each run. Both reach the gate only as evaluate's reviewerKeys. scenario() lays a spec, its snapshots and its record out in a fresh git repository, with
// the reviewed tree committed first at a fixed date (as build.sh does) so the record can name that commit.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sign, canonical, canonicalHash, generateKeyPair, keyId } from '../../../vendor/attest/signature.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..', '..');
/** The public half of the throwaway key the committed fixture trees are signed with. */
export const FIXTURE_PUB = fs.readFileSync(path.join(HERE, 'reviewer.pub'), 'utf8');
const RUN = generateKeyPair();
/** This run's test reviewer key. */
export const TEST_PRIV = RUN.privateKey;
export const TEST_PUB = RUN.publicKey;
/** The reviewer keys the tests inject: the fixture key and this run's key. */
export const KEYS = [FIXTURE_PUB, TEST_PUB];

export const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
export const specHash = (spec) => canonicalHash({ ...spec, workdir: null });
export const clone = (v) => JSON.parse(JSON.stringify(v));

const LATE_ROUND = ['sig', 'closing', 'amendments', 'folded'];
const LATE_ANSWER = ['disposition', 'reason', 'folded_as'];
const without = (o, ks) => Object.fromEntries(Object.entries(o).filter(([k]) => !ks.includes(k)));

/** The builder's part of a round: dispositions, reasons, folded_as, amendments, folded. */
export function late(round) {
  return {
    round: round.round,
    answers: (round.answers || []).map((a) => Object.fromEntries(['n', ...LATE_ANSWER].filter((k) => a[k] !== undefined).map((k) => [k, a[k]]))),
    amendments: round.amendments || [],
    ...(round.folded !== undefined ? { folded: round.folded } : {}),
  };
}

/** The payload a reviewer signs for round i: the round minus late fields, its snapshot's sha256, the previous round in full. */
export function roundBody(rounds, i, snapshotSha) {
  const r = without(rounds[i], LATE_ROUND);
  if (Array.isArray(rounds[i].answers)) r.answers = rounds[i].answers.map((a) => without(a, LATE_ANSWER));
  return { ...r, snapshot_sha256: snapshotSha, previous: i > 0 ? rounds[i - 1] : null };
}

export const closingBody = (specId, round) => ({ spec_id: specId, round: round.round, dispositions: late(round) });

/**
 * Sign every round in order with `priv` (each covers the previous round in full, so order matters), and
 * add a closing envelope to the last spec round when it has anything the builder wrote. redteamDir holds
 * the snapshots. skip: round indexes to leave unsigned.
 */
export function signRecord(rec, redteamDir, priv = TEST_PRIV, { closing = true, skip = [], id = rec.spec_id } = {}) {
  const rounds = rec.rounds;
  let lastSpec = -1;
  rounds.forEach((r, i) => { if (r.kind !== 'implementation') lastSpec = i; });
  rounds.forEach((r, i) => {
    delete r.sig;
    if (i === lastSpec) delete r.closing;
    const f = path.join(redteamDir, `${id}.r${i + 1}.spec.json`);
    const snap = fs.existsSync(f) ? sha256(fs.readFileSync(f)) : null;
    if (!skip.includes(i)) r.sig = sign(roundBody(rounds, i, snap), priv);
    const content = (r.answers || []).length || (r.amendments || []).length || r.folded !== undefined;
    if (i === lastSpec && closing && content && !rec.stop) r.closing = sign(closingBody(rec.spec_id, r), priv);
  });
  return rec;
}

/** A stop decision over the spec, signed by a contract-signing key. */
export function stopDecision(rec, spec, priv, extra = {}) {
  const open = [];
  for (const r of rec.rounds) for (const a of r.answers || []) if (a.disposition !== 'added') open.push({ round: r.round, n: a.n });
  const body = { spec_id: rec.spec_id, spec_sha256: specHash(spec), decider: 'the owner', date: '2026-10-31', decision: 'sign', open, dispositions: sha256(canonical(rec.rounds.map(late))), ...extra };
  return { ...body, sig: sign(body, priv) };
}

export function contractKey(dir) {
  const kp = generateKeyPair();
  const id = keyId(kp.publicKey);
  if (dir) { fs.mkdirSync(path.join(dir, 'contracts', 'keys'), { recursive: true }); fs.writeFileSync(path.join(dir, 'contracts', 'keys', `${id}.pub`), kp.publicKey); }
  return { ...kp, id };
}

export const GIT_ENV = (() => {
  const e = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.invalid', GIT_AUTHOR_DATE: '2026-01-01T00:00:00+0000', GIT_COMMITTER_DATE: '2026-01-01T00:00:00+0000' };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'NODE_TEST_CONTEXT']) delete e[k];
  return e;
})();

export function git(dir, args, { date } = {}) {
  const env = { ...GIT_ENV };
  if (date) { env.GIT_AUTHOR_DATE = date; env.GIT_COMMITTER_DATE = date; }
  const r = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir, env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

let tick = 0;
/** Commit everything in the working tree, at a date later than the reviewed commit. */
export function commitAll(dir, msg = 'change') {
  git(dir, ['add', '-A']);
  tick++;
  git(dir, ['commit', '-q', '--allow-empty', '-m', msg], { date: `2026-02-01T00:00:${String(tick % 60).padStart(2, '0')}+0000` });
  return git(dir, ['rev-parse', 'HEAD']);
}

/** build.sh: the reviewed tree at a fixed date, then `steps`, then the record. "base" runs the first step only, "rest" the others. */
export function buildSh(steps = '') {
  return `# Commits this fixture tree the way the red-team gate tests expect: first everything except the
# red-team record, at a fixed date, so the record can name that commit as the one the reviewer read;
# then any later change the case needs; then the record. Usage: sh build.sh [base|rest]
set -e
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t.invalid
export GIT_AUTHOR_DATE='2026-01-01T00:00:00+0000' GIT_COMMITTER_DATE='2026-01-01T00:00:00+0000'
if [ "$1" != rest ]; then
  git add -A -- . ':(glob,exclude)contracts/*/redteam/**'
  git -c commit.gpgsign=false commit -q -m 'the tree the reviewer read'
fi
if [ "$1" = base ]; then exit 0; fi
${steps ? `${steps}\n` : ''}git add -A
git -c commit.gpgsign=false commit -q --allow-empty -m 'red-team record'
`;
}

function sh(dir, script, arg) {
  const r = spawnSync('sh', [script, ...(arg ? [arg] : [])], { cwd: dir, env: GIT_ENV, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`sh ${script} ${arg || ''} failed: ${r.stderr}`);
}

export const FILES = { 'src/a.mjs': 'export const a = 1;\n', 'src/b.mjs': "export { a } from './a.mjs';\n" };

const STOP = ['If any criterion fails after the fix: STOP and report the failing check and file:line.'];
/** The fixture spec, as round 2 reviewed it (and as it is on disk in the base fixture). */
export function specV2() {
  return {
    title: 'QL-0.01 Fixture contract for the red-team gate tests',
    project: 'memev',
    workdir: null,
    request: 'A fixture spec: a module a and its test, and a module b that depends on it.',
    tasks: [
      {
        id: 'T1', title: 'The module a', phase: 'implement', depends_on: [],
        requirements: ['src/a.mjs exports a', 'the test of a fails before a exists and passes after'],
        description: '', scope: ['src/a.mjs', 'test/a.test.mjs'],
        criteria: [
          { statement: 'T1-c01: the test of a fails on the base and passes now', verifier: { type: 'test_red_green', test_file: 'test/a.test.mjs', cmd: "node --test --test-name-pattern='^T1-c01:' test/a.test.mjs" } },
          { statement: 'src/a.mjs exports a', verifier: { type: 'grep', file: 'src/a.mjs', pattern: 'export const a' } },
          { statement: 'the tests of a pass', verifier: { type: 'command', cmd: 'node --test test/a.test.mjs', timeout_s: 300 } },
          { statement: 'T1-c04: a refuses a missing input', verifier: { type: 'test_red_green', test_file: 'test/a.test.mjs', cmd: "node --test --test-name-pattern='^T1-c04:' test/a.test.mjs" } },
          { statement: 'Changes stay in scope', verifier: { type: 'scope' } },
        ],
        stop_rules: STOP,
      },
      {
        id: 'T2', title: 'The module b', phase: 'implement', depends_on: ['T1'],
        requirements: ['src/b.mjs re-exports a'],
        description: '', scope: ['src/b.mjs', 'test/b.test.mjs'],
        criteria: [
          { statement: 'T2-c01: the test of b fails on the base and passes now', verifier: { type: 'test_red_green', test_file: 'test/b.test.mjs', cmd: 'node --test test/b.test.mjs' } },
          { statement: 'b keeps its speed', verifier: { type: 'metric', cmd: 'node bench/b.mjs', key: 'ratio', op: '>=', value: 0.9 } },
          { statement: 'b answers fast', verifier: { type: 'metric', cmd: 'node bench/b.mjs', key: 'p50_ms', op: '<', value: 50 } },
          { statement: 'the lint passes', verifier: { type: 'command', cmd: 'node scripts/lint.mjs', expect_exit: 0 } },
          { statement: 'b is wired to a', verifier: { type: 'wiring', entry: 'src/b.mjs', symbol: 'a' } },
          { statement: 'Changes stay in scope', verifier: { type: 'scope' } },
        ],
        stop_rules: STOP,
      },
    ],
  };
}
/** The fixture spec as round 1 reviewed it: without the criterion round 1's answer 1 added. */
export function specV1() {
  const s = specV2();
  s.tasks[0].criteria = s.tasks[0].criteria.filter((c) => !c.statement.startsWith('T1-c04:'));
  return s;
}

/** Round partials of the base record (the gate fields scenario() fills in are left out). */
export function baseRounds() {
  const v2 = specV2();
  return [
    {
      verdict: 'findings',
      notes: '1. T1 has no check that a refuses a missing input. 2. The grep of T1 is weak but not contradictory.',
      answers: [
        { n: 1, severity: 'high', how: 'a missing input is accepted and nothing checks it', criterion: { task: 'T1', ...clone(v2.tasks[0].criteria[3]) }, disposition: 'added' },
        { n: 2, severity: 'medium', how: 'the scope could be narrower', disposition: 'rejected', reason: 'the scope already names the two files and nothing else' },
      ],
    },
    {
      verdict: 'clean',
      answers: [
        { n: 1, severity: 'medium', how: 'the metric threshold could be tighter', disposition: 'rejected', reason: 'the threshold is the measured baseline' },
        { n: 2, severity: 'low', how: 'the grep should stay', criterion: { task: 'T1', ...clone(v2.tasks[0].criteria[1]) }, disposition: 'added' },
        { n: 3, severity: 'low', how: 'the request text is long', disposition: 'rejected', reason: 'the request is not part of any check' },
      ],
    },
  ];
}

/**
 * A spec, its snapshots and its signed record in a fresh git repository. Options: snapshots (one spec per
 * round, null for an implementation round), disk (the spec on disk), rounds (partials), files, inputs
 * (paths the last round lists), manifest (a row's extra fields, or null for no manifest), steps (shell
 * lines build.sh runs after the reviewed commit), sign (false: leave unsigned), priv, closing, id, area.
 */
export function scenario(o = {}) {
  const id = o.id ?? 'QL-0.01';
  const area = o.area ?? 'quality-loop';
  const dir = o.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'redteam-gate-'));
  const snapshots = o.snapshots ?? [specV1(), specV2()];
  const disk = o.disk ?? clone([...snapshots].reverse().find(Boolean));
  const files = o.files ?? FILES;
  const spec = `contracts/${area}/specs/${id}.json`;
  const redteam = `contracts/${area}/redteam`;
  const write = (p, body) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), body); };
  for (const [p, body] of Object.entries(files)) write(p, body);
  write(spec, typeof disk === 'string' ? disk : `${JSON.stringify(disk, null, 2)}\n`);
  if (o.manifest !== null) write(`contracts/${area}/manifest.json`, `${JSON.stringify({ schema: 'memev-quality-loop/1', contracts: [{ id, ...(o.manifest ?? { kind: 'feature' }) }] }, null, 2)}\n`);
  for (const [p, body] of Object.entries(o.extra ?? {})) write(p, body);
  write('build.sh', buildSh(o.steps));
  git(dir, ['init', '-q']);
  sh(dir, 'build.sh', 'base');
  const reviewed = git(dir, ['rev-parse', 'HEAD']);
  const kind = o.manifestKind ?? (o.manifest === null ? 'feature' : (o.manifest?.kind ?? 'feature'));
  const partials = o.rounds ?? baseRounds();
  let lastSpec = -1;
  partials.forEach((r, i) => { if (r.kind !== 'implementation') lastSpec = i; });
  const inputs = (o.inputs ?? Object.keys(files).filter((p) => p.startsWith('src/'))).map((p) => ({ path: p, sha256: sha256(fs.readFileSync(path.join(dir, p.replace(/^\.\//, '')))) }));
  const rounds = partials.map((r, i) => ({
    round: i + 1,
    spec_sha256: specHash(snapshots[i] ?? (typeof disk === 'string' ? JSON.parse(disk) : disk)),
    base_commit: reviewed,
    inputs: { scopes: [], files: inputs },
    ...(i === lastSpec ? { manifest_kind: kind } : {}),
    verdict: i === lastSpec ? 'clean' : 'findings',
    answers: [],
    ...clone(r),
  }));
  const rec = { schema: 'memev-redteam/1', spec_id: id, rounds, ...(o.record ?? {}) };
  snapshots.forEach((s, i) => { if (s) write(`${redteam}/${id}.r${i + 1}.spec.json`, typeof s === 'string' ? s : `${JSON.stringify(s, null, 2)}\n`); });
  if (o.sign !== false) signRecord(rec, path.join(dir, redteam), o.priv ?? TEST_PRIV, { closing: o.closing ?? true, id });
  if (o.beforeRecordCommit) o.beforeRecordCommit(rec, dir);
  write(`${redteam}/${id}.json`, `${JSON.stringify(rec, null, 2)}\n`);
  sh(dir, 'build.sh', 'rest');
  return handle(dir, { id, area, spec, redteam, reviewed, priv: o.priv ?? TEST_PRIV });
}

/** Wrap an existing tree (a scenario or a copied fixture) with readers, writers and the re-signer. */
export function handle(dir, { id = 'QL-0.01', area = 'quality-loop', reviewed = null, priv = TEST_PRIV } = {}) {
  const spec = `contracts/${area}/specs/${id}.json`;
  const redteam = `contracts/${area}/redteam`;
  const recordFile = path.join(dir, redteam, `${id}.json`);
  const h = {
    dir, id, spec, redteam, reviewed, recordFile,
    abs: (p) => path.join(dir, p),
    read: (p) => JSON.parse(fs.readFileSync(path.join(dir, p), 'utf8')),
    write: (p, v) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), typeof v === 'string' ? v : `${JSON.stringify(v, null, 2)}\n`); },
    record: () => JSON.parse(fs.readFileSync(recordFile, 'utf8')),
    snapshot: (n) => h.read(`${redteam}/${id}.r${n}.spec.json`),
    setSnapshot: (n, s) => h.write(`${redteam}/${id}.r${n}.spec.json`, s),
    disk: () => h.read(spec),
    setDisk: (s) => h.write(spec, s),
    /** Change the record with fn, sign it again with the test key (unless sign:false), and write it. */
    mutate: (fn, { sign: resign = true, closing = true, skip = [] } = {}) => {
      const rec = h.record();
      fn(rec);
      if (resign) signRecord(rec, path.join(dir, redteam), priv, { closing, skip, id });
      fs.writeFileSync(recordFile, `${JSON.stringify(rec, null, 2)}\n`);
      return rec;
    },
    commit: (msg) => commitAll(dir, msg),
    git: (args) => git(dir, args),
  };
  return h;
}

/** A fresh copy of a committed fixture tree, committed by its build.sh. */
export function fresh(fixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redteam-fixture-'));
  fs.cpSync(fixture, dir, { recursive: true });
  git(dir, ['init', '-q']);
  sh(dir, 'build.sh');
  return dir;
}
