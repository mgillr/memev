// SPDX-License-Identifier: Apache-2.0
// QL-1.01 T1: the red-team gate. Each labelled test is one criterion of the contract (T1-cNN). Every record
// here is signed with a test key (the fixture key of test/fixtures/redteam/reviewer.pub, or a key made for
// this run) that reaches the gate only through evaluate's reviewerKeys; the committed base fixture alone is
// meant for the reviewer key in REVIEWER_KEYS.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluate, gate, RULES, REVIEWER_KEYS, GRANDFATHERED } from '../scripts/gate/redteam-gate.mjs';
import * as G from '../scripts/gate/redteam-gate.mjs';
import { DEFAULT_SPEC_DIRS, defaultSpecs } from '../src/engine/redteam-gate.mjs';
import { canonicalHash, sign, keyId, generateKeyPair } from '../vendor/attest/signature.mjs';
import { makeTask, skeleton } from '../vendor/attest/contract.mjs';
import { HERE, ROOT, KEYS, TEST_PRIV, TEST_PUB, FIXTURE_PUB, GIT_ENV, scenario, fresh, specV1, specV2, baseRounds, clone, specHash, stopDecision, contractKey, git, FILES, signRecord, closingBody, roundBody, signAs, STOP_PAYLOAD } from './fixtures/redteam/lib.mjs';
import { newVault, cleanup, OWNER } from './helpers/tmp.mjs';

const GATE = path.join(ROOT, 'scripts', 'gate', 'redteam-gate.mjs');
const BASE = path.join(HERE, 'base');
const CASES = path.join(HERE, 'cases');
const SPEC = 'contracts/quality-loop/specs/QL-0.01.json';
const RECORD = 'contracts/quality-loop/redteam/QL-0.01.json';
// spec_sha256 of the base fixture's spec, pinned by hand
const BASE_SPEC_SHA256 = 'e14fb15d44b9f0388a514cc9583fb6f664730c1bd04fdfd074e8b2a24ff5491f';

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
after(cleanup);
const sc = (o) => { const s = scenario(o); made.push(s.dir); return s; };
const fr = (fixture) => { const d = fresh(fixture); made.push(d); return d; };
// a scenario whose stop decision a test signed (stopWith) carries that key, and the gate is given it as stopKeys
const ev = (s, extra = {}) => evaluate({ spec: s.spec ?? SPEC, cwd: s.dir ?? s, reviewerKeys: KEYS, ...(s.stopKey ? { stopKeys: [s.stopKey.publicKey] } : {}), ...extra });
const cli = (dir, args) => spawnSync(process.execPath, [GATE, ...args], { cwd: dir, env: GIT_ENV, encoding: 'utf8' });
const has = (r, code) => r.codes.includes(code);
const reason = (r, code) => r.reasons.filter((x) => x.startsWith(`${code}:`)).join(' | ');
const signable = (r, msg) => assert.equal(r.status, 'SIGNABLE', `${msg || ''} ${r.reasons.join(' | ')}`);
const refused = (r, code, msg) => { assert.equal(r.status, 'NOT SIGNABLE', msg); assert.ok(has(r, code), `${msg || ''}: expected ${code}, got ${r.reasons.join(' | ')}`); };

/** The one-field mutations of the base record or spec, one per reason code. */
const MUTATE = {
  schema: (s) => s.mutate((r) => { r.schema = 'memev-redteam/0'; }),
  spec_id: (s) => s.mutate((r) => { r.spec_id = 'QL-0.02'; }),
  rounds_contiguous: (s) => s.mutate((r) => { r.rounds[1].round = 3; }),
  last_clean: (s) => s.mutate((r) => { r.rounds[1].verdict = 'findings'; }),
  last_high: (s) => s.mutate((r) => { r.rounds[1].answers[0].severity = 'high'; }),
  hash: (s) => s.mutate((r) => { r.rounds[1].spec_sha256 = '0'.repeat(64); }),
  dispositions_all_rounds: (s) => s.mutate((r) => { delete r.rounds[0].answers[1].disposition; }),
  added_verbatim: (s) => s.mutate((r) => { r.rounds[0].answers[0].criterion.statement += ' (reworded)'; }),
  rejected_reason: (s) => s.mutate((r) => { r.rounds[0].answers[1].reason = ''; }),
  never_weakens: (s) => { const d = s.disk(); d.workdir = '/tmp/elsewhere'; s.setDisk(d); },
  red_green_required: (s) => s.mutate((r) => { r.rounds[1].manifest_kind = 'docs'; }),
  head_stale_src: (s) => s.mutate((r) => { r.rounds[1].inputs.files[0].sha256 = '0'.repeat(64); }),
  review_sig: (s) => s.mutate((r) => { delete r.rounds[1].sig; }, { sign: false }),
  stop_decision: (s) => s.mutate((r) => { r.stop = stopDecision(r, s.disk(), TEST_PRIV); }, { sign: false }),
};

/** A two-round chain r1 -> r2 where r2 (clean) is `change(specV2())` and the disk equals r2. */
const chain = (change, o = {}) => { const v2 = specV2(); change(v2); return sc({ snapshots: [o.v1 ?? specV1(), v2], disk: v2, ...o }); };
const weakened = (r, task, statement, msg) => {
  refused(r, 'never_weakens', msg);
  const w = reason(r, 'never_weakens');
  assert.ok(w.includes(`task ${task}`), `${msg}: the reason names task ${task}: ${w}`);
  if (statement) assert.ok(w.includes(statement), `${msg}: the reason names "${statement}": ${w}`);
};

/** A spec with one task. */
function oneTask(t = {}, top = {}) {
  return {
    title: 'QL-0.01 One task', project: 'memev', workdir: null, request: 'one task',
    tasks: [{ id: 'T1', title: 'The task', phase: 'implement', depends_on: [], requirements: ['it works'], description: '', scope: ['src/a.mjs', 'test/a.test.mjs'], criteria: [{ statement: 'T1-c01: it fails first', verifier: { type: 'test_red_green', test_file: 'test/a.test.mjs', cmd: 'node --test test/a.test.mjs' } }, { statement: 'Changes stay in scope', verifier: { type: 'scope' } }], stop_rules: ['STOP and report.'], ...t }],
    ...top,
  };
}
const plainRounds = (n = 2) => Array.from({ length: n }, (_, i) => ({ verdict: i === n - 1 ? 'clean' : 'findings', answers: [] }));

const drafted = (spec) => spec.tasks.map((t, i) => makeTask({ id: t.id || `T${i + 1}`, title: t.title, phase: t.phase || 'implement', depends_on: t.depends_on || [], requirements: t.requirements || [], description: t.description || '', scope: t.scope || ['**'], criteria: t.criteria || [], stop_rules: t.stop_rules || [] }));
/** contracts/signed/<id>.json drafted from `spec` and signed by a contract key under contracts/keys/. */
function signContract(dir, spec, { id = 'k-xyz-abc123', key = contractKey(dir), provenance, tasks, title, sig = true, extra = {} } = {}) {
  const c = { ...skeleton('memev'), id, title: title ?? spec.title, workdir: null, created: '2026-10-31T00:00:00Z', version: 1, provenance: provenance === undefined ? { spec_sha256: specHash(spec) } : provenance, tasks: tasks ?? drafted(spec), ...extra };
  if (c.provenance === null) delete c.provenance;
  fs.mkdirSync(path.join(dir, 'contracts', 'signed'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'contracts', 'signed', `${id}.json`), `${JSON.stringify(c, null, 2)}\n`);
  if (sig) fs.writeFileSync(path.join(dir, 'contracts', 'signed', `${id}.sig.json`), `${JSON.stringify(sign(c, key.privateKey), null, 2)}\n`);
  return { c, key };
}

/**
 * Differences between two fixture trees, as paths. Envelopes count as present or absent only, and base_commit
 * not at all: both follow from the rest (a reviewer key signs the content; build.sh makes the reviewed commit).
 */
function treeDiff(a, b) {
  const files = (d) => { const out = []; const walk = (p) => { for (const e of fs.readdirSync(path.join(d, p), { withFileTypes: true })) { const q = p ? `${p}/${e.name}` : e.name; if (e.isDirectory()) walk(q); else out.push(q); } }; walk(''); return out; };
  const fa = files(a); const fb = files(b);
  const diffs = [];
  const leaves = (v, p, out) => {
    if (p.endsWith('/base_commit')) return;
    if (v && typeof v === 'object' && 'payloadType' in v && 'signatures' in v) { out.set(p, 'envelope'); return; }
    if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) leaves(x, `${p}/${k}`, out); if (!Object.keys(v).length) out.set(p, JSON.stringify(v)); return; }
    out.set(p, JSON.stringify(v));
  };
  for (const f of new Set([...fa, ...fb])) {
    if (!fa.includes(f) || !fb.includes(f)) { diffs.push(f); continue; }
    const ta = fs.readFileSync(path.join(a, f), 'utf8'); const tb = fs.readFileSync(path.join(b, f), 'utf8');
    if (ta === tb) continue;
    if (!f.endsWith('.json')) { diffs.push(f); continue; }
    const la = new Map(); const lb = new Map();
    leaves(JSON.parse(ta), f, la); leaves(JSON.parse(tb), f, lb);
    const changed = [...new Set([...la.keys(), ...lb.keys()])].filter((k) => la.get(k) !== lb.get(k));
    // a subtree present on one side only counts once, at its root
    const roots = changed.map((k) => { if (la.has(k) && lb.has(k)) return k; const other = la.has(k) ? lb : la; let r = k; while (r.includes('/') && ![...other.keys()].some((x) => x === r.slice(0, r.lastIndexOf('/')) || x.startsWith(`${r.slice(0, r.lastIndexOf('/'))}/`))) r = r.slice(0, r.lastIndexOf('/')); return r; });
    diffs.push(...new Set(roots));
  }
  return diffs;
}

test('T1-c01: each refusal rule has a fixture that is SIGNABLE until exactly one field is broken, and is then refused with that rule', () => {
  signable(ev(fr(path.join(CASES, 'ok'))), 'cases/ok');
  for (const code of RULES) {
    const d = treeDiff(path.join(CASES, 'ok'), path.join(CASES, code));
    assert.equal(d.length, 1, `cases/${code} differs from cases/ok in exactly one field, not ${JSON.stringify(d)}`);
    const r = ev(fr(path.join(CASES, code)));
    refused(r, code, `cases/${code}`);
  }
});

test('T1-c02: a spec edited after its clean round is NOT SIGNABLE until a new clean round', () => {
  const s = sc();
  signable(ev(s), 'base');
  const edited = s.disk();
  edited.tasks[1].criteria.splice(1, 0, { statement: 'T2-c07: b refuses a cycle', verifier: { type: 'test_red_green', test_file: 'test/b.test.mjs', cmd: "node --test --test-name-pattern='^T2-c07:' test/b.test.mjs" } });
  s.setDisk(edited);
  refused(ev(s), 'hash', 'edited after the clean round');
  s.setSnapshot(3, edited);
  const addRound = (verdict) => s.mutate((r) => { const r2 = r.rounds[1]; r.rounds.push({ round: 3, spec_sha256: specHash(edited), base_commit: r2.base_commit, inputs: clone(r2.inputs), manifest_kind: 'feature', verdict, answers: [] }); });
  addRound('findings');
  refused(ev(s), 'last_clean', 'a third round that is not clean');
  s.mutate((r) => { r.rounds.pop(); });
  addRound('clean');
  signable(ev(s), 'after a new clean round on the edited spec');
});

test('T1-c03: a high answer in a clean last round is refused with last_high, pending answers are refused, and a clean round of medium and low answers dispositioned with a closing envelope is SIGNABLE', () => {
  const s = sc();
  const r0 = s.record().rounds[1];
  assert.deepEqual(r0.answers.map((a) => [a.severity, a.disposition]), [['medium', 'rejected'], ['low', 'added'], ['low', 'rejected']]);
  assert.ok(r0.closing, 'the base fixture closes its last round');
  signable(ev(s), 'clean round with one medium rejected, one low added (present verbatim) and one low rejected');
  for (const d of ['added', 'rejected', 'pending']) {
    const t = sc();
    t.mutate((r) => { const a = r.rounds[1].answers[1]; a.severity = 'high'; if (d === 'rejected') { a.disposition = 'rejected'; a.reason = 'not needed'; } if (d === 'pending') a.disposition = 'pending'; });
    refused(ev(t), 'last_high', `a high answer ${d}`);
  }
  const p = sc();
  p.mutate((r) => { r.rounds[1].answers[2].disposition = 'pending'; delete r.rounds[1].answers[2].reason; });
  refused(ev(p), 'dispositions_all_rounds', 'a low answer left pending');
});

test('T1-c05: the command line exits non-zero for every refused fixture and for no record, so `gate && next` never proceeds; it exits 0 and proceeds for the SIGNABLE base fixture', () => {
  const proceeds = (dir, args) => spawnSync('sh', ['-c', `"${process.execPath}" "${GATE}" ${args.join(' ')} && echo PROCEED`], { cwd: dir, env: GIT_ENV, encoding: 'utf8' }).stdout.includes('PROCEED');
  for (const code of RULES) {
    const dir = fr(path.join(CASES, code));
    assert.equal(ev(dir).status, 'NOT SIGNABLE', `cases/${code} is refused in-process too`);
    const r = cli(dir, [SPEC]);
    assert.notEqual(r.status, 0, `cases/${code}: ${r.stdout}`);
    assert.ok(r.stdout.includes('NOT SIGNABLE'), r.stdout);
    assert.equal(proceeds(dir, [SPEC]), false, `cases/${code} does not proceed`);
  }
  const none = fr(path.join(CASES, 'ok'));
  fs.rmSync(path.join(none, RECORD));
  const n = cli(none, [SPEC]);
  assert.notEqual(n.status, 0);
  assert.match(n.stdout, /NO RECORD/);
  assert.equal(proceeds(none, [SPEC]), false);
  // the base fixture is signed with the reviewer key REVIEWER_KEYS holds, so it passes the real command line
  const base = fr(BASE);
  fs.cpSync(path.join(base, SPEC), path.join(base, 'contracts/quality-loop/specs/QL-0.09.json'));
  const two = cli(base, [SPEC, 'contracts/quality-loop/specs/QL-0.09.json']);
  assert.notEqual(two.status, 0, 'two specs, one SIGNABLE and one with no record');
  const b = cli(base, [SPEC]);
  assert.equal(b.status, 0, `the base fixture must be signed with the reviewer key in REVIEWER_KEYS (node test/fixtures/redteam/build-fixtures.mjs --base-key <reviewer key>): ${b.stdout}`);
  assert.equal(proceeds(base, [SPEC]), true);
});

test('T1-c06: spec_sha256 is the canonical hash with workdir null, pinned; content changes break it, key order and formatting do not; the record cannot name another spec file', () => {
  const s = sc();
  const disk = s.disk();
  const r = ev(s);
  assert.equal(r.spec_sha256, BASE_SPEC_SHA256);
  assert.equal(r.spec_sha256, canonicalHash({ ...disk, workdir: null }));
  signable(r);
  const edits = {
    'the first cmd': (d) => { d.tasks[0].criteria[0].verifier.cmd += ' --x'; },
    'a scope glob': (d) => { d.tasks[0].scope[0] = 'src/a2.mjs'; },
    'interior whitespace of a statement': (d) => { d.tasks[0].criteria[1].statement = d.tasks[0].criteria[1].statement.replace(' ', '  '); },
  };
  for (const [what, f] of Object.entries(edits)) {
    const d = clone(disk); f(d); s.setDisk(d);
    const x = ev(s);
    assert.equal(x.status, 'NOT SIGNABLE', what);
    assert.match(reason(x, 'hash'), /reviewed spec .* the spec on disk is/, what);
  }
  const reorder = (v) => (Array.isArray(v) ? v.map(reorder) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reorder(v[k])])) : v);
  s.setDisk(`${JSON.stringify(reorder(disk), null, 4)}\n`);
  signable(ev(s), 'keys reordered');
  s.setDisk(JSON.stringify(disk));
  signable(ev(s), 'reformatted on one line');
  s.setDisk(disk);
  s.write('contracts/quality-loop/specs/QL-0.01-copy.json', disk);
  s.mutate((rec) => { rec.spec_file = 'contracts/quality-loop/specs/QL-0.01-copy.json'; });
  refused(ev(s), 'spec_id', 'the record names a different spec file with the same hash');
  s.mutate((rec) => { rec.spec_file = SPEC; });
  signable(ev(s), 'spec_file naming the spec itself');
});

test('T1-c07: verifier, statement, stop rule, requirement, depends_on and workdir changes between snapshots are refused as weakenings; a swap is not a removal', () => {
  const cases = [
    ['a grep pattern changed', 'T1', 'src/a.mjs exports a', (v) => { v.tasks[0].criteria[1].verifier.pattern = 'export'; }],
    ['a grep file changed', 'T1', 'src/a.mjs exports a', (v) => { v.tasks[0].criteria[1].verifier.file = 'src/b.mjs'; }],
    ['a test_red_green test_file changed', 'T1', 'T1-c01: the test of a fails', (v) => { v.tasks[0].criteria[0].verifier.test_file = 'test/z.test.mjs'; }],
    ['expect_exit changed', 'T2', 'the lint passes', (v) => { v.tasks[1].criteria[3].verifier.expect_exit = 1; }],
    ['expect_exit removed', 'T2', 'the lint passes', (v) => { delete v.tasks[1].criteria[3].verifier.expect_exit; }],
    ['mandatory:false added', 'T2', 'the lint passes', (v) => { v.tasks[1].criteria[3].mandatory = false; }],
    ['a statement rewritten', 'T2', 'b answers fast', (v) => { v.tasks[1].criteria[2].statement = 'b answers quickly'; }],
    ['a stop_rule removed', 'T1', null, (v) => { v.tasks[0].stop_rules = []; }],
    ['a requirement removed', 'T1', null, (v) => { v.tasks[0].requirements.pop(); }],
    ['a depends_on entry removed', 'T2', null, (v) => { v.tasks[1].depends_on = []; }],
  ];
  for (const [what, task, statement, change] of cases) weakened(ev(chain(change)), task, statement, what);
  const wd = ev(chain((v) => { v.workdir = '/srv/work'; }));
  refused(wd, 'never_weakens', 'workdir set');
  assert.match(reason(wd, 'never_weakens'), /workdir/);
  const swapped = ev(chain((v) => { const c = v.tasks[1].criteria; [c[1], c[2]] = [c[2], c[1]]; }));
  signable(swapped, 'two criteria swapped');
});

test('T1-c08: a missing snapshot, a snapshot that is not its round\'s hash, and an r1 snapshot overwritten to hide a weakening are refused, naming the round', () => {
  const a = sc();
  fs.rmSync(a.abs('contracts/quality-loop/redteam/QL-0.01.r1.spec.json'));
  const ra = ev(a);
  refused(ra, 'hash');
  assert.match(reason(ra, 'hash'), /round 1: the snapshot .* is missing/);
  const b = sc();
  const v2 = b.snapshot(2); v2.tasks[0].title = 'Another title'; b.setSnapshot(2, v2);
  b.mutate(() => {});
  const rb = ev(b);
  refused(rb, 'hash');
  assert.match(reason(rb, 'hash'), /round 2: the snapshot's hash/);
  // a real weakening: r1 had a criterion r2 dropped
  const v1 = specV2(); v1.tasks[1].criteria.splice(1, 0, { statement: 'b is documented', verifier: { type: 'grep', file: 'docs/b.md', pattern: 'b' } });
  const c = sc({ snapshots: [v1, specV2()] });
  weakened(ev(c), 'T2', 'b is documented', 'the dropped criterion');
  c.setSnapshot(1, c.disk());
  c.mutate(() => {});
  const rc = ev(c);
  assert.equal(rc.status, 'NOT SIGNABLE', 'r1 overwritten with the current spec');
  assert.match(reason(rc, 'hash'), /round 1: the snapshot's hash/);
});

test('T1-c09: an answer of round 1 that is pending, has no disposition, is rejected with a blank reason or is added with no criterion is refused naming round 1 and the answer', () => {
  const rounds = [{ verdict: 'findings', answers: [{ n: 1, severity: 'medium', how: 'a gap', disposition: 'rejected', reason: 'covered by the scope criterion' }] }, { verdict: 'clean', answers: [] }];
  const s = sc({ snapshots: [specV2(), specV2()], rounds });
  signable(ev(s), 'round 1 fully dispositioned');
  const cases = [
    ['pending', 'dispositions_all_rounds', (a) => { a.disposition = 'pending'; delete a.reason; }],
    ['no disposition', 'dispositions_all_rounds', (a) => { delete a.disposition; delete a.reason; }],
    ['a blank reason', 'rejected_reason', (a) => { a.reason = '   '; }],
    ['added with no criterion', 'added_verbatim', (a) => { a.disposition = 'added'; delete a.reason; }],
  ];
  for (const [what, code, f] of cases) {
    const t = sc({ snapshots: [specV2(), specV2()], rounds });
    t.mutate((r) => f(r.rounds[0].answers[0]));
    const r = ev(t);
    refused(r, code, what);
    assert.match(reason(r, code), /round 1 answer 1/, what);
  }
});

test('T1-c10: a command change is SIGNABLE only with an amendment in the round whose snapshot holds it, naming the same task, statement, from and to', () => {
  const OLD = 'node --test test/a.test.mjs';
  const NEW = 'node --test --test-reporter=tap test/a.test.mjs';
  const v1 = specV2(); v1.tasks[0].criteria[2].verifier.cmd = OLD;
  const v2 = specV2(); v2.tasks[0].criteria[2].verifier.cmd = NEW;
  const answer = { n: 1, severity: 'medium', how: 'the check is impossible as written: the plain reporter hides the failing name', criterion: { task: 'T1', statement: 'the tests of a pass', verifier: { type: 'command', cmd: NEW, timeout_s: 300 } }, disposition: 'added' };
  const am = { task: 'T1', statement: 'the tests of a pass', from: OLD, to: NEW, answer: '1.1' };
  const make = (r2, { r1 = {}, spec2 = v2 } = {}) => ev(sc({ snapshots: [v1, spec2], rounds: [{ verdict: 'findings', answers: [answer], ...r1 }, { verdict: 'clean', answers: [], ...r2 }] }));
  signable(make({ amendments: [am] }), 'the amendment');
  refused(make({}), 'never_weakens', 'no amendment');
  refused(make({ amendments: [{ ...am, statement: 'src/a.mjs exports a' }] }), 'never_weakens', 'an amendment naming a different criterion');
  refused(make({ amendments: [{ ...am, to: `${NEW} --x` }] }), 'never_weakens', 'an amendment whose to differs');
  const both = clone(v2); both.tasks[1].criteria[3].verifier.cmd = 'node scripts/lint.mjs --strict';
  refused(make({ amendments: [am] }, { spec2: both }), 'never_weakens', 'one amendment covering two changed commands');
  refused(make({}, { r1: { amendments: [am] } }), 'never_weakens', 'the amendments list in round 1, not the round whose snapshot holds the change');
});

test('T1-c11: an input under src/ that changed at HEAD is refused even when the working tree is restored, written ./src or deleted; a changed docs input is reported only; no inputs with a src/ scope is refused', () => {
  const s = sc();
  fs.writeFileSync(s.abs('src/a.mjs'), 'export const a = 2;\n'); s.commit('a changes');
  const r = ev(s);
  refused(r, 'head_stale_src');
  assert.match(reason(r, 'head_stale_src'), /src\/a\.mjs/);
  fs.writeFileSync(s.abs('src/a.mjs'), FILES['src/a.mjs']);
  refused(ev(s), 'head_stale_src', 'working tree restored, HEAD still changed');
  const dot = sc({ inputs: ['./src/a.mjs', 'src/b.mjs'] });
  signable(ev(dot), './src/a.mjs before the change');
  fs.writeFileSync(dot.abs('src/a.mjs'), 'export const a = 3;\n'); dot.commit('a changes');
  const rd = ev(dot);
  refused(rd, 'head_stale_src', './src/a.mjs');
  assert.match(reason(rd, 'head_stale_src'), /src\/a\.mjs/);
  const del = sc();
  fs.rmSync(del.abs('src/a.mjs')); del.commit('a deleted');
  const rx = ev(del);
  refused(rx, 'head_stale_src', 'deleted at HEAD');
  assert.match(reason(rx, 'head_stale_src'), /src\/a\.mjs/);
  const docs = sc({ files: { ...FILES, 'docs/x.md': '# x\n' }, inputs: ['src/a.mjs', 'src/b.mjs', 'docs/x.md'] });
  fs.writeFileSync(docs.abs('docs/x.md'), '# x, changed\n'); docs.commit('docs change');
  const rdoc = ev(docs);
  signable(rdoc, 'a changed docs input');
  assert.ok(rdoc.reported.some((x) => x.startsWith('docs/x.md ')), JSON.stringify(rdoc.reported));
  const empty = sc({ inputs: [] });
  refused(ev(empty), 'head_stale_src', 'inputs.files [] with a src/ scope');
});

test('T1-c12: RULES is the literal list; the base is SIGNABLE; each code has a one-field mutation refused with that code alone; red_green_required follows the manifest row', () => {
  assert.deepEqual([...RULES], ['schema', 'spec_id', 'rounds_contiguous', 'last_clean', 'last_high', 'hash', 'dispositions_all_rounds', 'added_verbatim', 'rejected_reason', 'never_weakens', 'red_green_required', 'head_stale_src', 'review_sig', 'stop_decision']);
  assert.deepEqual(Object.keys(MUTATE), [...RULES]);
  signable(ev(sc()), 'the base');
  for (const code of RULES) {
    const s = sc();
    MUTATE[code](s);
    const r = ev(s);
    assert.equal(r.status, 'NOT SIGNABLE', code);
    assert.deepEqual(r.codes, [code], `${code}: ${r.reasons.join(' | ')}`);
  }
  const noRG = oneTask({ criteria: [{ statement: 'the docs name it', verifier: { type: 'grep', file: 'docs/a.md', pattern: 'a' } }, { statement: 'Changes stay in scope', verifier: { type: 'scope' } }] });
  const withManifest = (manifest, manifestKind, spec = noRG) => ev(sc({ snapshots: [spec, spec], rounds: plainRounds(), manifest, manifestKind }));
  refused(withManifest(null), 'red_green_required', 'no manifest');
  refused(withManifest({}), 'red_green_required', 'a row without a kind');
  refused(withManifest({ kind: 'feature' }), 'red_green_required', 'kind feature');
  signable(withManifest({ kind: 'docs' }), 'kind docs');
  signable(withManifest({ kind: 'evidence' }), 'kind evidence');
  refused(withManifest({ kind: 'feature' }, undefined, { ...noRG, kind: 'docs', tasks: noRG.tasks.map((t) => ({ ...t, kind: 'docs' })) }), 'red_green_required', 'a kind in the spec alone');
});

test('T1-c13: an added answer whose spec criterion has the same task, statement and type but another verifier is refused; an exact match is SIGNABLE', () => {
  signable(ev(sc()), 'exact match');
  const cases = {
    'a different cmd': (r) => { r.rounds[0].answers[0].criterion.verifier.cmd += ' --x'; },
    'a different test_file': (r) => { r.rounds[0].answers[0].criterion.verifier.test_file = 'test/z.test.mjs'; },
    'a different grep pattern': (r) => { r.rounds[1].answers[1].criterion.verifier.pattern = 'export const'; },
  };
  for (const [what, f] of Object.entries(cases)) { const s = sc(); s.mutate(f); refused(ev(s), 'added_verbatim', what); }
});

test('T1-c14: with no arguments the gate reads both default spec directories; a missing spec or no specs at all exits non-zero saying so', () => {
  const q = fr(path.join(CASES, 'schema'));
  const rq = cli(q, []);
  assert.notEqual(rq.status, 0);
  assert.match(rq.stdout, /contracts\/quality-loop\/specs\/QL-0\.01\.json: NOT SIGNABLE/);
  const sr = sc({ area: 'seed-readiness', id: 'SR-0.01' });
  sr.mutate((r) => { r.schema = 'memev-redteam/0'; });
  const rs = cli(sr.dir, []);
  assert.notEqual(rs.status, 0);
  assert.match(rs.stdout, /contracts\/seed-readiness\/specs\/SR-0\.01\.json: NOT SIGNABLE/);
  const missing = cli(q, ['contracts/quality-loop/specs/QL-9.99.json']);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /no such spec: contracts\/quality-loop\/specs\/QL-9\.99\.json/);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'redteam-empty-')); made.push(empty);
  const re = cli(empty, []);
  assert.notEqual(re.status, 0);
  assert.match(re.stderr, /no specs found/);
});

test('G1: the default spec directories include the programme specs, so a plain run and --report read them', () => {
  assert.ok(DEFAULT_SPEC_DIRS.includes('contracts/programme/specs'));
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'redteam-programme-')); made.push(d);
  fs.mkdirSync(path.join(d, 'contracts/programme/specs'), { recursive: true });
  fs.writeFileSync(path.join(d, 'contracts/programme/specs/PG-01.1-example.json'), `${JSON.stringify({ title: 'PG-01.1 example', project: 'memev', workdir: null, tasks: [{ id: 'T1', title: 'a', phase: 'design', criteria: [{ statement: 'x', verifier: { type: 'file_exists', path: 'a' } }] }] }, null, 2)}\n`);
  assert.deepEqual(defaultSpecs(d), ['contracts/programme/specs/PG-01.1-example.json']);
  const plain = cli(d, []);
  assert.match(plain.stdout, /contracts\/programme\/specs\/PG-01\.1-example\.json: NO RECORD/);
  const rep = cli(d, ['--report']);
  assert.match(rep.stdout, /contracts\/programme\/specs\/PG-01\.1-example\.json: NO RECORD/);
  assert.match(rep.stdout, /examined 1 specs/);
  // a signed contract of a programme spec is found by title when the directory is read; without the directory it is an orphan
  assert.equal(path.posix.basename(DEFAULT_SPEC_DIRS.at(-1)), 'specs');
});

test('T1-c16: rounds are DSSE envelopes by a reviewer key that is not a contract key; unsigned rounds, contract-key rounds and edits after signing are refused with review_sig', () => {
  const single = sc({ snapshots: [specV2()], rounds: [{ verdict: 'clean', answers: [] }], sign: false });
  refused(ev(single), 'review_sig', 'a single clean round with no sig');
  single.mutate(() => {});
  signable(ev(single), 'the same round signed with the injected test key');
  assert.equal(evaluate({ spec: SPEC, cwd: single.dir }).status, 'NOT SIGNABLE', 'without the injected key the test key is not trusted');
  // signed by a contract-signing key, even when that key is also offered as a reviewer key
  const ck = sc({ snapshots: [specV2()], rounds: [{ verdict: 'clean', answers: [] }], sign: false });
  const key = contractKey(ck.dir);
  const rec = ck.record(); signRecord(rec, ck.abs(ck.redteam), key.privateKey, { id: 'QL-0.01' }); fs.writeFileSync(ck.recordFile, JSON.stringify(rec));
  refused(ev(ck), 'review_sig', 'signed by the contract key');
  const both = ev(ck, { reviewerKeys: [TEST_PUB, key.publicKey] });
  refused(both, 'review_sig', 'a contract key offered as a reviewer key');
  assert.match(reason(both, 'review_sig'), /contract-signing key under contracts\/keys/);
  // r1.spec.json and rounds[0].spec_sha256 rewritten together after r2 was signed
  const c = sc();
  c.setSnapshot(1, specV2());
  c.mutate((r) => { r.rounds[0].spec_sha256 = specHash(specV2()); }, { sign: false });
  const rc = ev(c);
  refused(rc, 'review_sig', 'snapshot and hash rewritten together');
  assert.ok(!/round 1: the snapshot/.test(reason(rc, 'hash')), 'the hashes agree, only the signatures catch it');
  // a round-1 disposition edited after round 2 was signed
  const d = sc();
  d.mutate((r) => { r.rounds[0].answers[1].reason = 'a different reason'; }, { sign: false });
  refused(ev(d), 'review_sig', 'a round-1 reason edited');
  // a round-2 amendment edited after round 3 was signed
  const v1 = specV2(); v1.tasks[0].criteria[2].verifier.cmd = 'node --test test/a.test.mjs --old';
  const ans = { n: 1, severity: 'medium', how: 'impossible as written', criterion: { task: 'T1', statement: 'the tests of a pass', verifier: clone(specV2().tasks[0].criteria[2].verifier) }, disposition: 'added' };
  const three = sc({ snapshots: [v1, specV2(), specV2()], rounds: [{ verdict: 'findings', answers: [ans] }, { verdict: 'findings', answers: [], amendments: [{ task: 'T1', statement: 'the tests of a pass', from: v1.tasks[0].criteria[2].verifier.cmd, to: specV2().tasks[0].criteria[2].verifier.cmd, answer: '1.1' }] }, { verdict: 'clean', answers: [] }] });
  signable(ev(three), 'three signed rounds with an amendment in round 2');
  three.mutate((r) => { r.rounds[1].amendments[0].answer = '1.1 '; }, { sign: false });
  refused(ev(three), 'review_sig', 'a round-2 amendment edited');
  signable(ev(sc()), 'a correctly signed chain with the injected test key');
});

test('T1-c17: a spec on disk with a workdir is refused with never_weakens naming workdir although the hash still matches', () => {
  const s = sc();
  const d = s.disk(); d.workdir = '/tmp/elsewhere'; s.setDisk(d);
  assert.equal(canonicalHash({ ...d, workdir: null }), s.record().rounds[1].spec_sha256);
  const r = ev(s);
  refused(r, 'never_weakens');
  assert.match(reason(r, 'never_weakens'), /workdir/);
  d.workdir = null; s.setDisk(d);
  signable(ev(s), 'workdir null');
});

test('T1-c18: scope, verifier type, metric, task, criterion, cmd, timeout, flags, phase and requirement changes between snapshots are refused naming the task', () => {
  const cases = [
    ['scope glob broadened to **', 'T1', null, (v) => { v.tasks[0].scope = ['**']; }],
    ['scope glob added', 'T1', null, (v) => { v.tasks[0].scope.push('docs/a.md'); }],
    ['test_red_green to command, same cmd', 'T1', 'T1-c01: the test of a fails', (v) => { const c = v.tasks[0].criteria[0]; c.verifier = { type: 'command', cmd: c.verifier.cmd }; }],
    ['metric 0.9 to 0.5 under >=', 'T2', 'b keeps its speed', (v) => { v.tasks[1].criteria[1].verifier.value = 0.5; }],
    ['metric op < to <=', 'T2', 'b answers fast', (v) => { v.tasks[1].criteria[2].verifier.op = '<='; }],
    ['metric key changed', 'T2', 'b keeps its speed', (v) => { v.tasks[1].criteria[1].verifier.key = 'other'; }],
    ['task T2 deleted', 'T2', null, (v) => { v.tasks.pop(); }],
    ['the last criterion of T1 deleted', 'T1', 'Changes stay in scope', (v) => { v.tasks[0].criteria.pop(); }],
    ['test_red_green cmd changed, no amendment', 'T1', 'T1-c01: the test of a fails', (v) => { v.tasks[0].criteria[0].verifier.cmd += ' --x'; }],
    ['timeout_s 300 to 3000', 'T1', 'the tests of a pass', (v) => { v.tasks[0].criteria[2].verifier.timeout_s = 3000; }],
    ['grep flags i added', 'T1', 'src/a.mjs exports a', (v) => { v.tasks[0].criteria[1].verifier.flags = 'i'; }],
    ['phase implement to verify', 'T1', null, (v) => { v.tasks[0].phase = 'verify'; }],
    ['a requirement reworded', 'T1', null, (v) => { v.tasks[0].requirements[0] = 'src/a.mjs exports something'; }],
  ];
  for (const [what, task, statement, change] of cases) weakened(ev(chain(change)), task, statement, what);
  signable(ev(chain((v) => { v.tasks[1].criteria[1].verifier.value = 0.95; })), 'a metric tightened');
});

test('T1-c19: an added criterion with mandatory:false or an extra key is refused with added_verbatim; a criterion first appearing with mandatory:false is refused with never_weakens', () => {
  const withC4 = (extra) => chain((v) => { Object.assign(v.tasks[0].criteria[3], extra); });
  const opt = ev(withC4({ mandatory: false }));
  refused(opt, 'added_verbatim', 'mandatory:false on the added criterion');
  refused(opt, 'never_weakens', 'mandatory:false on a new criterion');
  refused(ev(withC4({ note: 'extra' })), 'added_verbatim', 'an extra key on the added criterion');
  signable(ev(withC4({ mandatory: true })), 'mandatory:true');
  signable(ev(withC4({ id: 'T1-AC04' })), 'an id');
  const fresh2 = chain((v) => { v.tasks[1].criteria.splice(1, 0, { statement: 'b logs', verifier: { type: 'grep', file: 'src/b.mjs', pattern: 'log' }, mandatory: false }); });
  refused(ev(fresh2), 'never_weakens', 'a new criterion with mandatory:false');
  signable(ev(chain((v) => { v.tasks[1].criteria.splice(1, 0, { statement: 'b logs', verifier: { type: 'grep', file: 'src/b.mjs', pattern: 'log' } }); })), 'the same new criterion, mandatory');
});

test('T1-c20: red_green_required judges the drafted tasks, counts only mandatory test_red_green criteria, and needs manifest_kind to equal the manifest row', () => {
  const grepOnly = oneTask({ phase: undefined, criteria: [{ statement: 'a exists', verifier: { type: 'grep', file: 'src/a.mjs', pattern: 'a' } }, { statement: 'Changes stay in scope', verifier: { type: 'scope' } }] });
  delete grepOnly.tasks[0].phase;
  refused(ev(sc({ snapshots: [grepOnly, grepOnly], rounds: plainRounds() })), 'red_green_required', 'no phase key and only grep criteria');
  const optional = oneTask(); optional.tasks[0].criteria[0].mandatory = false;
  refused(ev(sc({ snapshots: [optional, optional], rounds: plainRounds() })), 'red_green_required', 'the only test_red_green is mandatory:false');
  refused(ev(sc({ snapshots: [oneTask(), oneTask()], rounds: plainRounds(), manifest: { kind: 'docs' }, manifestKind: 'feature' })), 'red_green_required', 'reviewed as feature, the row now says docs');
  const two = oneTask(); two.tasks.push({ ...clone(two.tasks[0]), id: 'T2', title: 'Another', depends_on: ['T1'] });
  signable(ev(sc({ snapshots: [two, two], rounds: plainRounds() })), 'one mandatory test_red_green per task');
});

test('T1-c21: the clean round names the reviewed commit; an in-scope change after it (listed or not, src/ or not, added) is refused; an out-of-scope change is reported', () => {
  const spec = oneTask({ scope: ['src/**', 'scripts/x.mjs'] });
  const files = { 'src/a.mjs': 'export const a = 1;\n', 'src/b.mjs': 'export const b = 1;\n', 'scripts/x.mjs': 'export const x = 1;\n', 'docs/x.md': '# x\n' };
  const make = () => sc({ snapshots: [spec, spec], rounds: plainRounds(), files, inputs: ['src/a.mjs'] });
  const base = make();
  assert.equal(base.record().rounds[1].base_commit, base.reviewed);
  signable(ev(base), 'before any change');
  const changes = { 'src/b.mjs': (s) => fs.writeFileSync(s.abs('src/b.mjs'), 'export const b = 2;\n'), 'src/new.mjs': (s) => fs.writeFileSync(s.abs('src/new.mjs'), 'export const n = 1;\n'), 'scripts/x.mjs': (s) => fs.writeFileSync(s.abs('scripts/x.mjs'), 'export const x = 2;\n') };
  for (const [f, change] of Object.entries(changes)) {
    const s = make(); change(s); s.commit(`${f} changes`);
    const r = ev(s);
    refused(r, 'head_stale_src', f);
    assert.ok(reason(r, 'head_stale_src').includes(f), reason(r, 'head_stale_src'));
  }
  const d = make(); fs.writeFileSync(d.abs('docs/x.md'), '# x, changed\n'); d.commit('docs');
  const rd = ev(d);
  signable(rd, 'only docs/x.md, outside the scope');
  assert.ok(rd.reported.some((x) => x.startsWith('docs/x.md ')), JSON.stringify(rd.reported));
});

test('T1-c22: --report fails on an orphan signed contract that is not grandfathered, on a record that is not JSON and on a clean record whose hash does not match; the grandfathered contract passes', () => {
  const real = fs.readFileSync(path.join(ROOT, 'contracts/signed/k-memory-quality-multiling-4468b8.json'), 'utf8');
  const tree = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'redteam-report-')); made.push(d); for (const x of ['contracts/quality-loop/specs', 'contracts/seed-readiness/specs', 'contracts/signed']) fs.mkdirSync(path.join(d, x), { recursive: true }); git(d, ['init', '-q']); return d; };
  const g = tree();
  fs.writeFileSync(path.join(g, 'contracts/signed/k-memory-quality-multiling-4468b8.json'), real);
  const rg = cli(g, ['--report']);
  assert.equal(rg.status, 0, rg.stdout + rg.stderr);
  assert.match(rg.stdout, /grandfathered/);
  const t = tree();
  const c = JSON.parse(real); c.title = `${c.title.slice(0, -1)}X`;
  fs.writeFileSync(path.join(t, 'contracts/signed/k-memory-quality-multiling-4468b8.json'), JSON.stringify(c, null, 2));
  const rt = cli(t, ['--report']);
  assert.notEqual(rt.status, 0, 'one title character changed');
  assert.match(rt.stdout, /k-memory-quality-multiling-4468b8\.json matches no spec/);
  const o = fr(path.join(CASES, 'ok'));
  assert.equal(cli(o, ['--report']).status, 0, 'a spec that is only NOT SIGNABLE does not fail the report');
  signContract(o, { ...oneTask(), title: 'Something else entirely' }, { tasks: [] });
  const ro = cli(o, ['--report']);
  assert.notEqual(ro.status, 0);
  assert.match(ro.stdout, /contracts\/signed\/k-xyz-abc123\.json matches no spec/);
  const bad = fr(path.join(CASES, 'ok'));
  fs.writeFileSync(path.join(bad, RECORD), '{ not json');
  assert.notEqual(cli(bad, ['--report']).status, 0, 'a record that is not JSON');
  const mism = fr(path.join(CASES, 'ok'));
  const spec = JSON.parse(fs.readFileSync(path.join(mism, SPEC), 'utf8')); spec.tasks[0].title = 'Changed'; fs.writeFileSync(path.join(mism, SPEC), JSON.stringify(spec));
  const rm = cli(mism, ['--report']);
  assert.notEqual(rm.status, 0, 'a clean record whose hash does not match');
  assert.match(rm.stdout, /claims clean but the hash does not match/);
  assert.deepEqual([...GRANDFATHERED], [canonicalHash(JSON.parse(real))]);
});

test('T1-c23: --report judges staleness at the commit that signed the contract; the plain run judges it at HEAD', () => {
  const spec = oneTask({ scope: ['src/x.mjs', 'test/a.test.mjs'] });
  const make = () => sc({ snapshots: [spec, spec], rounds: plainRounds(), files: { 'src/x.mjs': 'export const x = 1;\n' } });
  const s = make();
  signContract(s.dir, spec); s.commit('sign k-xyz-abc123');
  fs.writeFileSync(s.abs('src/x.mjs'), 'export const x = 2;\n'); s.commit('the work lands');
  const rep = gate({ cwd: s.dir, report: true, reviewerKeys: KEYS });
  assert.equal(rep.exit, 0, rep.lines.join('\n'));
  refused(ev(s), 'head_stale_src', 'the plain run at HEAD');
  const early = make();
  fs.writeFileSync(early.abs('src/x.mjs'), 'export const x = 2;\n'); early.commit('changed before signing');
  signContract(early.dir, spec); early.commit('sign k-xyz-abc123');
  const re = gate({ cwd: early.dir, report: true, reviewerKeys: KEYS });
  assert.notEqual(re.exit, 0, 'src/x.mjs changed before the signing commit');
  assert.match(re.lines.join('\n'), /head_stale_src/);
});

test('T1-c24: a scope path added for an added criterion is accepted with a scope_add amendment citing it; without one, or as a glob, it is refused', () => {
  const crit = { statement: 'T1-c09: a handles a new case', verifier: { type: 'test_red_green', test_file: 'test/new.test.mjs', cmd: 'node --test test/new.test.mjs' } };
  const v1 = specV2();
  const make = (glob, amendments) => { const v2 = specV2(); v2.tasks[0].scope.push(glob); v2.tasks[0].criteria.splice(4, 0, clone(crit)); return ev(sc({ snapshots: [v1, v2], rounds: [{ verdict: 'findings', answers: [{ n: 1, severity: 'medium', how: 'a new case is not tested', criterion: { task: 'T1', ...clone(crit) }, disposition: 'added' }] }, { verdict: 'clean', answers: [], ...(amendments ? { amendments } : {}) }] })); };
  signable(make('test/new.test.mjs', [{ task: 'T1', scope_add: 'test/new.test.mjs', answer: '1.1' }]), 'with the scope_add entry');
  refused(make('test/new.test.mjs'), 'never_weakens', 'without the entry');
  refused(make('test/**', [{ task: 'T1', scope_add: 'test/**', answer: '1.1' }]), 'never_weakens', 'a glob instead of the path');
});

test('T1-c25: a duplicate key in the spec or a snapshot is refused with schema although the parsed hash matches', () => {
  const s = sc();
  const text = JSON.stringify(s.disk(), null, 2);
  const cmd = '"cmd": "node --test test/b.test.mjs"';
  assert.ok(text.includes(cmd));
  const dup = text.replace(cmd, `"cmd": "node --test test/x.test.mjs",\n            ${cmd}`);
  s.setDisk(dup);
  assert.equal(canonicalHash({ ...JSON.parse(dup), workdir: null }), s.record().rounds[1].spec_sha256);
  const r = ev(s);
  refused(r, 'schema', 'the spec');
  assert.match(reason(r, 'schema'), /cmd twice/);
  const t = sc();
  t.setSnapshot(2, dup);
  t.mutate(() => {});
  refused(ev(t), 'schema', 'the r2 snapshot');
});

test('T1-c29: a reviewed commit that is absent, or present but not an ancestor of HEAD, is refused with head_stale_src although every input matches', () => {
  signable(ev(fr(path.join(CASES, 'ok'))), 'build.sh makes the commit the record names');
  const a = sc();
  a.mutate((r) => { r.rounds[1].base_commit = 'f'.repeat(40); });
  const ra = ev(a);
  refused(ra, 'head_stale_src', 'absent');
  assert.match(reason(ra, 'head_stale_src'), /not in this repository/);
  const b = sc();
  b.git(['checkout', '-q', '-b', 'side']);
  fs.writeFileSync(b.abs('side.txt'), 'side\n');
  const side = b.commit('a side commit');
  b.git(['checkout', '-q', '-']);
  b.mutate((r) => { r.rounds[1].base_commit = side; });
  const rb = ev(b);
  refused(rb, 'head_stale_src', 'not an ancestor');
  assert.match(reason(rb, 'head_stale_src'), /not an ancestor of HEAD/);
  assert.deepEqual(rb.codes, ['head_stale_src']);
});

test('T1-c30: --report fails for a signed contract with a missing or bad signature, a missing or wrong provenance hash, or a commit that is not after the clean round; the right one passes', () => {
  const spec = oneTask();
  const make = () => sc({ snapshots: [spec, spec], rounds: plainRounds() });
  const report = (s) => gate({ cwd: s.dir, report: true, reviewerKeys: KEYS });
  const good = make(); signContract(good.dir, spec); good.commit('sign');
  assert.equal(report(good).exit, 0, report(good).lines.join('\n'));
  const nosig = make(); signContract(nosig.dir, spec, { sig: false }); nosig.commit('sign');
  assert.notEqual(report(nosig).exit, 0, 'no .sig.json');
  const badsig = make(); const k = signContract(badsig.dir, spec).key; const other = generateKeyPair();
  const c = JSON.parse(fs.readFileSync(badsig.abs('contracts/signed/k-xyz-abc123.json'), 'utf8'));
  const env = sign(c, other.privateKey); env.signatures[0].keyid = k.id;
  fs.writeFileSync(badsig.abs('contracts/signed/k-xyz-abc123.sig.json'), JSON.stringify(env)); badsig.commit('sign');
  assert.notEqual(report(badsig).exit, 0, 'a signature that does not verify against contracts/keys/<keyid>.pub');
  const noprov = make(); signContract(noprov.dir, spec, { provenance: null }); noprov.commit('sign');
  assert.notEqual(report(noprov).exit, 0, 'no provenance.spec_sha256');
  const wrong = make(); signContract(wrong.dir, spec, { provenance: { spec_sha256: '0'.repeat(64) } }); wrong.commit('sign');
  assert.notEqual(report(wrong).exit, 0, 'another provenance.spec_sha256');
  // signed in the reviewed commit, before the record's clean round was committed
  const key = generateKeyPair(); const kid = keyId(key.publicKey);
  const c2 = { ...skeleton('memev'), id: 'k-xyz-abc123', title: spec.title, workdir: null, created: '2026-10-31T00:00:00Z', version: 1, provenance: { spec_sha256: specHash(spec) }, tasks: drafted(spec) };
  const before = sc({ snapshots: [spec, spec], rounds: plainRounds(), extra: { 'contracts/signed/k-xyz-abc123.json': `${JSON.stringify(c2, null, 2)}\n`, 'contracts/signed/k-xyz-abc123.sig.json': JSON.stringify(sign(c2, key.privateKey)), [`contracts/keys/${kid}.pub`]: key.publicKey } });
  const rb = report(before);
  assert.notEqual(rb.exit, 0, 'committed before the clean round');
  assert.match(rb.lines.join('\n'), /committed before the record's clean round/);
});

test('T1-c31: added expect_exit, must, cwd and a changed wiring symbol are weakenings; an amendment citing no answer of the previous round, or an answer about something else, is refused', () => {
  const cases = [
    ['expect_exit: 1 added to a command with none', 'T1', 'the tests of a pass', (v) => { v.tasks[0].criteria[2].verifier.expect_exit = 1; }],
    ["must: 'absent' added to a grep", 'T1', 'src/a.mjs exports a', (v) => { v.tasks[0].criteria[1].verifier.must = 'absent'; }],
    ["cwd: '/tmp' added to a command", 'T1', 'the tests of a pass', (v) => { v.tasks[0].criteria[2].verifier.cwd = '/tmp'; }],
    ['a wiring symbol changed', 'T2', 'b is wired to a', (v) => { v.tasks[1].criteria[4].verifier.symbol = 'b'; }],
  ];
  for (const [what, task, statement, change] of cases) weakened(ev(chain(change)), task, statement, what);
  // cmd amendments
  const OLD = 'node --test test/a.test.mjs'; const NEW = 'node --test --test-reporter=tap test/a.test.mjs';
  const v1 = specV2(); v1.tasks[0].criteria[2].verifier.cmd = OLD;
  const v2 = specV2(); v2.tasks[0].criteria[2].verifier.cmd = NEW;
  const right = { n: 1, severity: 'medium', how: 'impossible as written', criterion: { task: 'T1', statement: 'the tests of a pass', verifier: { type: 'command', cmd: NEW, timeout_s: 300 } }, disposition: 'added' };
  const elsewhere = { n: 2, severity: 'low', how: 'impossible as written', criterion: { task: 'T1', statement: 'src/a.mjs exports a', verifier: clone(v2.tasks[0].criteria[1].verifier) }, disposition: 'added' };
  const cmd = (answer) => ev(sc({ snapshots: [v1, v2], rounds: [{ verdict: 'findings', answers: [right, elsewhere] }, { verdict: 'clean', answers: [], amendments: [{ task: 'T1', statement: 'the tests of a pass', from: OLD, to: NEW, answer }] }] }));
  refused(cmd('1.9'), 'never_weakens', 'a cmd amendment citing no answer');
  refused(cmd('2.1'), 'never_weakens', 'a cmd amendment citing an answer of another round');
  refused(cmd('1.2'), 'never_weakens', 'a cmd amendment citing an answer about a different criterion');
  signable(cmd('1.1'), 'the cmd amendment citing the right answer');
  // scope_add amendments
  const crit = { statement: 'T1-c09: a handles a new case', verifier: { type: 'test_red_green', test_file: 'test/new.test.mjs', cmd: 'node --test test/new.test.mjs' } };
  const s2 = specV2(); s2.tasks[0].scope.push('test/new.test.mjs'); s2.tasks[0].criteria.splice(4, 0, clone(crit));
  const reads = { n: 1, severity: 'medium', how: 'untested', criterion: { task: 'T1', ...clone(crit) }, disposition: 'added' };
  const readsNot = { n: 2, severity: 'low', how: 'grep', criterion: { task: 'T1', ...clone(v2.tasks[0].criteria[1]) }, disposition: 'added' };
  const scope = (answer) => ev(sc({ snapshots: [specV2(), s2], rounds: [{ verdict: 'findings', answers: [reads, readsNot] }, { verdict: 'clean', answers: [], amendments: [{ task: 'T1', scope_add: 'test/new.test.mjs', answer }] }] }));
  refused(scope('1.7'), 'never_weakens', 'a scope_add citing no answer');
  refused(scope('1.2'), 'never_weakens', 'a scope_add citing an answer that reads no path under it');
  signable(scope('1.1'), 'the scope_add citing the right answer');
});

test('T1-c32: a test_red_green counts only when its cmd runs its own test_file', () => {
  const rg = (cmd) => { const s = oneTask(); s.tasks[0].criteria[0].verifier = { type: 'test_red_green', test_file: 'test/a.test.mjs', cmd }; return ev(sc({ snapshots: [s, s], rounds: plainRounds() })); };
  refused(rg('test -f src/a.mjs'), 'red_green_required', 'a cmd that runs no test');
  refused(rg('node --test test/other.test.mjs'), 'red_green_required', 'a cmd that runs another test file');
  signable(rg('node --test test/a.test.mjs'), 'a cmd that runs its test_file');
  signable(rg('node --test {test}'), 'the {test} placeholder');
});

test('T1-c33: a record whose committed history held more rounds than it holds now is refused with rounds_contiguous, and so is a snapshot beyond the last round', () => {
  const v1 = specV2(); const v2 = specV2(); v2.tasks[1].criteria.splice(1, 0, { statement: 'T2-c08: b refuses a cycle', verifier: { type: 'test_red_green', test_file: 'test/b.test.mjs', cmd: 'node --test test/b.test.mjs' } });
  const s = sc({ snapshots: [v1, v2], rounds: [{ verdict: 'clean', answers: [], manifest_kind: 'feature' }, { verdict: 'findings', answers: [{ n: 1, severity: 'medium', how: 'a gap' }] }] });
  fs.rmSync(s.abs('contracts/quality-loop/redteam/QL-0.01.r2.spec.json'));
  s.mutate((r) => { r.rounds.pop(); });
  s.setDisk(v1);
  s.commit('round 2 removed, spec v1 restored');
  const r = ev(s);
  assert.equal(r.status, 'NOT SIGNABLE');
  assert.deepEqual(r.codes, ['rounds_contiguous'], r.reasons.join(' | '));
  assert.match(reason(r, 'rounds_contiguous'), /earlier committed version of the record .* held 2 rounds/);
  const t = sc();
  t.setSnapshot(3, specV2());
  refused(ev(t), 'rounds_contiguous', 'r3 snapshot beside a two-round record');
});

test('T1-c35: a stop decision after three unclean rounds, signed by a contract key over the spec on disk and listing every open answer, prints SIGNABLE AT STOP; every flaw in it is refused with stop_decision', () => {
  const v = specV2();
  const answersOf = (round) => ({
    1: [{ n: 1, severity: 'high', how: 'a missing input', criterion: { task: 'T1', ...clone(v.tasks[0].criteria[3]) }, disposition: 'added' }, { n: 2, severity: 'medium', how: 'scope', disposition: 'rejected', reason: 'the scope is two files' }],
    2: [{ n: 1, severity: 'high', how: 'a cycle', disposition: 'rejected', reason: 'b has no imports of its own' }],
    3: [{ n: 1, severity: 'high', how: 'speed', disposition: 'rejected', reason: 'the baseline is measured' }, { n: 2, severity: 'low', how: 'grep', criterion: { task: 'T1', ...clone(v.tasks[0].criteria[1]) }, disposition: 'added' }],
  })[round];
  const make = (n = 3) => sc({ snapshots: [specV1(), ...Array.from({ length: n - 1 }, () => specV2())], rounds: Array.from({ length: n }, (_, i) => ({ verdict: 'findings', answers: answersOf(i + 1), ...(i === 1 ? { amendments: [{ task: 'T2', statement: 'the lint passes', from: 'x', to: 'y', answer: '1.2' }] } : {}) })) });
  // the stop decision and its key are committed together: a key only in the working tree never signs a stop. The key sits under
  // contracts/keys/ and reaches the gate as stopKeys (requirement 12: STOP_KEYS in production)
  const stop = (s, key, extra = {}) => { s.stopKey = key; s.mutate((r) => { r.stop = stopDecision(r, s.disk(), key.privateKey, extra); }); s.commit('the stop decision and its key'); };
  const s = make(); const key = contractKey(s.dir);
  stop(s, key);
  const r = ev(s);
  assert.equal(r.status, 'SIGNABLE AT STOP', r.reasons.join(' | '));
  assert.deepEqual(r.open, [{ round: 1, n: 2 }, { round: 2, n: 1 }, { round: 3, n: 1 }]);
  const plain = gate({ cwd: s.dir, specs: [SPEC], reviewerKeys: KEYS, stopKeys: [key.publicKey] });
  assert.equal(plain.exit, 0);
  assert.match(plain.lines.join('\n'), /SIGNABLE AT STOP \(3 open items\)/);
  const rep = gate({ cwd: s.dir, specs: [SPEC], report: true, reviewerKeys: KEYS, stopKeys: [key.publicKey] }).lines.join('\n');
  for (const o of r.open) assert.ok(rep.includes(`open: round ${o.round} answer ${o.n}`), rep);
  const two = make(2); stop(two, contractKey(two.dir));
  refused(ev(two), 'stop_decision', 'after two rounds');
  const byReviewer = make(); stop(byReviewer, { privateKey: TEST_PRIV, publicKey: TEST_PUB });
  refused(ev(byReviewer), 'stop_decision', 'signed by the reviewer key');
  refused(ev(byReviewer, { stopKeys: undefined }), 'stop_decision', 'signed by the reviewer key, judged with STOP_KEYS');
  const leftOut = make(); stop(leftOut, contractKey(leftOut.dir), { open: [{ round: 1, n: 2 }, { round: 2, n: 1 }] });
  refused(ev(leftOut), 'stop_decision', 'an open answer left out');
  const otherHash = make(); stop(otherHash, contractKey(otherHash.dir), { spec_sha256: '0'.repeat(64) });
  refused(ev(otherHash), 'stop_decision', 'another spec hash');
  const edited = make(); stop(edited, contractKey(edited.dir));
  edited.mutate((x) => { x.rounds[2].answers[0].reason = 'edited after the stop'; }, { sign: false });
  refused(ev(edited), 'stop_decision', 'a rejected reason edited after the stop');
  const amended = make(); stop(amended, contractKey(amended.dir));
  amended.mutate((x) => { x.rounds[1].amendments[0].to = 'z'; }, { sign: false });
  refused(ev(amended), 'stop_decision', 'an amendment edited after the stop');
});

test('T1-c36: a last round with medium or low answers needs a valid closing envelope over its dispositions', () => {
  signable(ev(sc()), 'with a valid closing envelope');
  const none = sc(); none.mutate(() => {}, { closing: false });
  refused(ev(none), 'review_sig', 'no closing envelope');
  const other = sc(); const k = generateKeyPair();
  other.mutate((r) => { r.rounds[1].closing = sign(closingBody(r.spec_id, r.rounds[1]), k.privateKey); }, { sign: false });
  refused(ev(other), 'review_sig', 'a closing envelope by a key not in REVIEWER_KEYS');
  const edited = sc();
  edited.mutate((r) => { r.rounds[1].answers[2].reason = 'edited after closing'; }, { sign: false });
  const re = ev(edited);
  refused(re, 'review_sig', 'a disposition edited after the closing envelope');
  assert.match(reason(re, 'review_sig'), /closing envelope covers other content/);
});

test('a signed implementation round appended after the clean round leaves SIGNABLE as it is, an unsigned one is refused, and its own verdict is reported', () => {
  const impl = (round) => sc({ snapshots: [specV1(), specV2(), null], rounds: [...baseRounds(), { kind: 'implementation', verdict: 'clean', answers: [], ...round }] });
  const good = ev(impl({}));
  signable(good, 'a clean implementation round');
  assert.equal(good.implementation.clean, true, good.implementation.reasons.join(' | '));
  const high = ev(impl({ answers: [{ n: 1, severity: 'high', how: 'a bug', disposition: 'added', criterion: { task: 'T1', statement: 'x', verifier: { type: 'scope' } } }] }));
  signable(high, 'an implementation round with a high answer');
  assert.equal(high.implementation.clean, false);
  const s = impl({}); s.mutate((r) => { delete r.rounds[2].sig; }, { sign: false });
  const unsigned = ev(s);
  refused(unsigned, 'review_sig', 'an unsigned implementation round');
  assert.equal(unsigned.implementation.clean, false);
  assert.match(unsigned.implementation.reasons.join(' '), /review_sig/);
});

test('the reviewer key the gate trusts is the reviewer\'s, never the fixture test key', () => {
  // exactly the reviewer's key and the one interim key the owner approved on 31 October 2026, in this order; a third key fails here
  assert.deepEqual(REVIEWER_KEYS.map(keyId), ['1f6b4e7c00729bc7', 'ba7f5a5b8f8aa026']);
  for (const k of REVIEWER_KEYS) {
    assert.notEqual(keyId(k), keyId(TEST_PUB));
    assert.notEqual(keyId(k), keyId(FIXTURE_PUB));
  }
});

test('T1-c37: an added answer folded as another criterion is judged by its folded_as: the folded criterion verbatim in the spec is SIGNABLE, an absent one or a string is refused', () => {
  const fold = (f) => { const s = sc(); s.mutate((r) => { const a = r.rounds[0].answers[0]; a.folded_as = clone(a.criterion); a.criterion.statement += ' (as the reviewer worded it)'; f(a); }); return ev(s); };
  signable(fold(() => {}), 'the proposal reworded, folded_as naming the criterion in the spec');
  refused(fold((a) => { a.folded_as.statement += ' (not in the spec)'; }), 'added_verbatim', 'folded_as naming a criterion the spec lacks');
  refused(fold((a) => { a.folded_as.verifier = { ...a.folded_as.verifier, cmd: `${a.folded_as.verifier.cmd ?? ''} --x` }; }), 'added_verbatim', 'folded_as with another verifier');
  refused(fold((a) => { a.folded_as = a.folded_as.statement.slice(0, 80); }), 'added_verbatim', 'folded_as as a string prefix');
  const s = sc(); s.mutate((r) => { r.rounds[0].answers[0].criterion.statement += ' (reworded)'; });
  refused(ev(s), 'added_verbatim', 'a reworded proposal with no folded_as');
});

/** A record of three findings rounds on specV1, specV2, specV2, none clean (as T1-c35 builds it), for a stop decision. */
const threeRounds = (o = {}) => {
  const v = specV2();
  const answersOf = (round) => ({
    1: [{ n: 1, severity: 'high', how: 'a missing input', criterion: { task: 'T1', ...clone(v.tasks[0].criteria[3]) }, disposition: 'added' }, { n: 2, severity: 'medium', how: 'scope', disposition: 'rejected', reason: 'the scope is two files' }],
    2: [{ n: 1, severity: 'high', how: 'a cycle', disposition: 'rejected', reason: 'b has no imports of its own' }],
    3: [{ n: 1, severity: 'high', how: 'speed', disposition: 'rejected', reason: 'the baseline is measured' }, { n: 2, severity: 'low', how: 'grep', criterion: { task: 'T1', ...clone(v.tasks[0].criteria[1]) }, disposition: 'added' }, ...(o.answers3 ?? [])],
  })[round];
  return sc({ snapshots: [specV1(), specV2(), specV2()], disk: o.disk, rounds: [1, 2, 3].map((n) => ({ verdict: 'findings', answers: answersOf(n) })) });
};
const stopWith = (s, key, extra = {}) => { s.stopKey = key; return s.mutate((r) => { r.stop = stopDecision(r, s.disk(), key.privateKey, extra); }); };

test('T1-c38: a round relabelled kind implementation in a later commit is refused with review_sig naming it; a trailing round unsigned or signed by another key is refused; a signed trailing implementation round with a high answer leaves the spec SIGNABLE', () => {
  const v1 = specV2(); const v2 = specV2(); v2.tasks[1].criteria.splice(1, 0, { statement: 'T2-c08: b refuses a cycle', verifier: { type: 'test_red_green', test_file: 'test/b.test.mjs', cmd: 'node --test test/b.test.mjs' } });
  const relabelled = (answer, { resign = false } = {}) => {
    const s = sc({ snapshots: [v1, v2], rounds: [{ verdict: 'clean', answers: [], manifest_kind: 'feature' }, { verdict: 'findings', answers: [clone(answer)] }] });
    s.mutate((r) => { r.rounds[1].kind = 'implementation'; }, { sign: resign });
    s.setDisk(v1);
    s.commit('round 2 relabelled as an implementation round, spec v1 restored');
    return ev(s);
  };
  for (const [what, answer] of [['one pending answer', { n: 1, severity: 'medium', how: 'a gap' }], ['one high answer', { n: 1, severity: 'high', how: 'a hole' }]]) {
    const r = relabelled(answer);
    refused(r, 'review_sig', `${what}, relabelled without signing again`);
    assert.match(reason(r, 'review_sig'), /round 2/, what);
    const again = relabelled(answer, { resign: true });
    refused(again, 'review_sig', `${what}, relabelled and signed again`);
    assert.match(reason(again, 'review_sig'), /round 2 is of kind implementation in .* but of kind spec in/, what);
  }
  const impl = () => sc({ snapshots: [specV1(), specV2(), null], rounds: [...baseRounds(), { kind: 'implementation', verdict: 'findings', answers: [{ n: 1, severity: 'high', how: 'a bug', disposition: 'added', criterion: { task: 'T1', statement: 'x', verifier: { type: 'scope' } } }] }] });
  signable(ev(impl()), 'a signed trailing implementation round holding a high answer');
  const unsigned = impl(); unsigned.mutate((r) => { delete r.rounds[2].sig; }, { sign: false });
  const ru = ev(unsigned);
  refused(ru, 'review_sig', 'an unsigned trailing implementation round');
  assert.match(reason(ru, 'review_sig'), /round 3/);
  const foreign = impl(); const k = generateKeyPair();
  foreign.mutate((r) => { r.rounds[2].sig = sign(roundBody(r.rounds, 2, null), k.privateKey); }, { sign: false });
  const rf = ev(foreign);
  refused(rf, 'review_sig', 'a trailing implementation round signed by a key outside reviewerKeys');
  assert.match(reason(rf, 'review_sig'), /round 3/);
});

test('T1-c39: --report judges a signed contract against the commit that added the clean round the record ends with, not an earlier clean round on the same hash', () => {
  const spec = oneTask();
  const make = (signBeforeR3) => {
    const s = sc({ snapshots: [spec], rounds: [{ verdict: 'clean', answers: [] }] });
    const r1 = s.record().rounds[0];
    const round = (n, verdict, answers, extra = {}) => s.mutate((r) => { r.rounds.push({ round: n, spec_sha256: specHash(spec), base_commit: r1.base_commit, inputs: clone(r1.inputs), verdict, answers, ...extra }); });
    s.setSnapshot(2, spec);
    round(2, 'findings', [{ n: 1, severity: 'high', how: 'a hole in the check', disposition: 'rejected', reason: 'the check is the base test' }]);
    s.commit('round 2: findings with one high answer');
    if (signBeforeR3) { signContract(s.dir, spec); s.commit('sign k-xyz-abc123'); }
    s.setSnapshot(3, spec);
    round(3, 'clean', [], { manifest_kind: 'feature' });
    s.commit('round 3: clean on the same spec');
    if (!signBeforeR3) { signContract(s.dir, spec); s.commit('sign k-xyz-abc123'); }
    return gate({ cwd: s.dir, report: true, reviewerKeys: KEYS });
  };
  const early = make(true);
  assert.notEqual(early.exit, 0, early.lines.join('\n'));
  assert.match(early.lines.join('\n'), /committed before the record's clean round/);
  const late = make(false);
  assert.equal(late.exit, 0, late.lines.join('\n'));
});

test('T1-c40: --report lists a contract a later signed version supersedes as superseded and judges only the last version; without that version it fails on the old tasks', () => {
  const s1 = oneTask();
  const s2 = oneTask(); s2.tasks[0].criteria.splice(1, 0, { statement: 'T1-c02: a refuses a missing input', verifier: { type: 'test_red_green', test_file: 'test/a.test.mjs', cmd: 'node --test test/a.test.mjs' } });
  const make = (withV2) => {
    const s = sc({ snapshots: [s1], rounds: [{ verdict: 'clean', answers: [] }] });
    const key = contractKey(s.dir);
    signContract(s.dir, s1, { id: 'k-one-task-v1aaaa', key }); s.commit('sign v1');
    const r1 = s.record().rounds[0];
    s.setSnapshot(2, s2); s.setDisk(s2);
    s.mutate((r) => { r.rounds.push({ round: 2, spec_sha256: specHash(s2), base_commit: r1.base_commit, inputs: clone(r1.inputs), manifest_kind: 'feature', verdict: 'clean', answers: [] }); });
    s.commit('S1 amended to S2 through a new clean round');
    if (withV2) { signContract(s.dir, s2, { id: 'k-one-task-v2bbbb', key, extra: { version: 2, supersedes: 'k-one-task-v1aaaa' } }); s.commit('sign v2'); }
    return gate({ cwd: s.dir, report: true, reviewerKeys: KEYS });
  };
  const two = make(true);
  assert.equal(two.exit, 0, two.lines.join('\n'));
  assert.match(two.lines.join('\n'), /contracts\/signed\/k-one-task-v1aaaa\.json: superseded by contracts\/signed\/k-one-task-v2bbbb\.json/);
  const one = make(false);
  assert.notEqual(one.exit, 0, one.lines.join('\n'));
  assert.match(one.lines.join('\n'), /k-one-task-v1aaaa\.json .*its tasks are not the tasks drafted from the spec/);
});

test('T1-c41: an added answer folded as a criterion already verbatim in its round\'s own snapshot is refused with added_verbatim; folded as one new since that snapshot it is SIGNABLE', () => {
  const v2 = specV2();
  const fold = (round, n, target) => { const s = sc(); s.mutate((r) => { const a = r.rounds[round - 1].answers.find((x) => x.n === n); a.folded_as = clone(target); a.criterion.statement += ' (as the reviewer worded it)'; }); return ev(s); };
  signable(fold(1, 1, { task: 'T1', ...v2.tasks[0].criteria[3] }), 'round 1 answer 1 folded as T1-c04, new since the round 1 snapshot');
  for (const [round, n] of [[1, 1], [2, 2]]) {
    const r = fold(round, n, { task: 'T1', ...v2.tasks[0].criteria[1] });
    refused(r, 'added_verbatim', `round ${round} answer ${n} folded as a criterion its own snapshot holds`);
    assert.deepEqual(r.codes, ['added_verbatim'], r.reasons.join(' | '));
    assert.match(reason(r, 'added_verbatim'), new RegExp(`round ${round} answer ${n} .*round ${round}'s own snapshot`));
  }
});

test('T1-c42: an added answer folded into the spec its task moved to is judged there, through the manifest and that spec\'s own replacements; an unrecorded move, an id the manifest does not resolve, a path, or an absent criterion is refused with added_verbatim', () => {
  const moved = { statement: 'b refuses a cycle', verifier: { type: 'test_red_green', test_file: 'test/b.test.mjs', cmd: 'node --test test/b.test.mjs' } };
  const other = (crit) => ({ ...specV2(), title: 'QL-0.02 The receiving contract', tasks: [{ ...specV2().tasks[1], id: 'T1', depends_on: [], criteria: [...specV2().tasks[1].criteria.slice(0, 1), ...(crit ? [crit] : []), ...specV2().tasks[1].criteria.slice(1)] }] });
  const manifest = (ids) => `${JSON.stringify({ schema: 'memev-quality-loop/1', contracts: ids.map((id) => ({ id, kind: 'feature' })) }, null, 2)}\n`;
  // the receiving spec's replacements count only as far as its record verifies, so its record is signed by a reviewer key
  const signed = (rec) => signRecord(clone(rec), path.join(os.tmpdir(), 'no-snapshots-here'), TEST_PRIV, { id: rec.spec_id });
  const make = ({ to = 'QL-0.02', recorded = true, ids = ['QL-0.01', 'QL-0.02'], crit = clone(moved), otherRecord } = {}) => {
    const rounds = baseRounds();
    rounds[0].answers.push({ n: 3, severity: 'medium', how: 'b has no cycle check', criterion: { task: 'T2', ...clone(moved) }, disposition: 'added', folded_as: { spec: to, task: 'T1', ...clone(moved) } });
    if (recorded) rounds[1].amendments = [{ kind: 'move', task: 'T2', to_spec: to, to_task: 'T1', answer: '1.3' }];
    const extra = { 'contracts/quality-loop/manifest.json': manifest(ids), 'contracts/quality-loop/specs/QL-0.02.json': `${JSON.stringify(other(crit), null, 2)}\n` };
    if (otherRecord) extra['contracts/quality-loop/redteam/QL-0.02.json'] = `${JSON.stringify(signed(otherRecord), null, 2)}\n`;
    return ev(sc({ rounds, extra }));
  };
  signable(make(), 'the move recorded, the id resolved through the manifest, the criterion verbatim there');
  const renamed = { ...clone(moved), statement: 'b refuses an import cycle' };
  const otherRecord = { schema: 'memev-redteam/1', spec_id: 'QL-0.02', rounds: [{ round: 1, amendments: [{ task: 'T1', field: 'statement', from: moved.statement, to: renamed.statement, answer: '1.1' }] }] };
  signable(make({ crit: renamed, otherRecord }), 'after a From/To replacement in the receiving spec');
  refused(make({ crit: renamed }), 'added_verbatim', 'the replacement not recorded there');
  for (const [what, o] of [['the move not recorded', { recorded: false }], ['an id the manifest does not resolve', { ids: ['QL-0.01'] }], ['a path instead of an id', { to: 'contracts/quality-loop/specs/QL-0.02.json' }], ['the criterion absent there', { crit: null }]]) {
    const r = make(o);
    refused(r, 'added_verbatim', what);
    assert.match(reason(r, 'added_verbatim'), /round 1 answer 3 folded into/, what);
  }
  // a task removed as moved is accepted only when the receiving task holds all of it, following that spec's own replacements
  const t2 = specV2().tasks[1];
  const taskMove = (receiving = {}, rec2, atSplit = []) => {
    const v2 = specV2(); v2.tasks = [v2.tasks[0]];
    const rounds = baseRounds(); rounds[1].amendments = [{ kind: 'move', task: 'T2', to_spec: 'QL-0.02', to_task: 'T1', answer: '1.1' }, ...atSplit];
    const recv = { ...specV2(), title: 'QL-0.02 The receiving contract', tasks: [{ ...clone(t2), id: 'T1', depends_on: [], ...receiving }] };
    const extra = { 'contracts/quality-loop/manifest.json': manifest(['QL-0.01', 'QL-0.02']), 'contracts/quality-loop/specs/QL-0.02.json': `${JSON.stringify(recv, null, 2)}\n` };
    if (rec2) extra['contracts/quality-loop/redteam/QL-0.02.json'] = `${JSON.stringify(signed(rec2), null, 2)}\n`;
    return ev(sc({ snapshots: [specV1(), v2], disk: v2, rounds, extra }));
  };
  const without = (st) => clone(t2.criteria).filter((c) => c.statement !== st);
  signable(taskMove(), 'task T2 moved whole to QL-0.02 T1');
  const renamedC = clone(t2.criteria).map((c) => (c.statement === 'b answers fast' ? { ...c, statement: 'b answers within 50 ms' } : c));
  signable(taskMove({ criteria: renamedC }, { schema: 'memev-redteam/1', spec_id: 'QL-0.02', rounds: [{ round: 1, amendments: [{ task: 'T1', field: 'statement', from: 'b answers fast', to: 'b answers within 50 ms', answer: '1.1' }] }] }), 'task T2 moved, one statement then replaced in QL-0.02');
  const lacks = taskMove({ criteria: without('b answers fast') });
  weakened(lacks, 'T2', null, 'the receiving task lacks one moved criterion');
  assert.match(reason(lacks, 'never_weakens'), /task T2 removed and its move is refused: QL-0\.02 T1 lacks the criterion "b answers fast"/);
  weakened(taskMove({ requirements: [] }), 'T2', null, 'the receiving task lacks the moved requirement');
  // a requirement reworded at the split counts through its From/To in the round that records the move, and only through it
  const reworded = 'src/b.mjs re-exports a from QL-0.01';
  signable(taskMove({ requirements: [reworded] }, undefined, [{ task: 'T2', field: 'requirement', from: 'src/b.mjs re-exports a', to: reworded, note: '1.2' }]), 'a moved requirement present through the replacement recorded at the split');
  weakened(taskMove({ requirements: [reworded] }), 'T2', null, 'the reworded requirement with no replacement recorded');
  // the replacements at the split count only with their own citations: uncited, they cannot rename a task into a stub
  const small = { id: 'T2', title: 'The module b', phase: 'implement', depends_on: ['T1'], requirements: ['b refuses a cycle'], description: '', scope: ['src/b.mjs', 'test/b.test.mjs'], criteria: [{ statement: 'b refuses a cycle', verifier: { type: 'test_red_green', test_file: 'test/b.test.mjs', cmd: 'node --test test/b.test.mjs' } }], stop_rules: [] };
  const stub = { ...specV2(), title: 'QL-0.02 The receiving contract', tasks: [{ ...clone(small), id: 'T1', depends_on: [], requirements: ['c prints a banner'], criteria: [{ statement: 'c prints a banner', verifier: { type: 'test_red_green', test_file: 'test/c.test.mjs', cmd: 'node --test test/c.test.mjs' } }] }] };
  const renames = [
    { task: 'T2', field: 'requirement', from: 'b refuses a cycle', to: 'c prints a banner' },
    { task: 'T2', field: 'statement', from: 'b refuses a cycle', to: 'c prints a banner' },
    { task: 'T2', field: 'verifier.test_file', statement: 'c prints a banner', from: 'test/b.test.mjs', to: 'test/c.test.mjs' },
    { task: 'T2', field: 'verifier.cmd', statement: 'c prints a banner', from: 'node --test test/b.test.mjs', to: 'node --test test/c.test.mjs' },
  ];
  const intoStub = (cite, record) => {
    const v1 = specV1(); v1.tasks[1] = clone(small);
    const v2 = specV2(); v2.tasks = [v2.tasks[0]];
    const rounds = baseRounds(); rounds[1].amendments = [{ kind: 'move', task: 'T2', to_spec: 'QL-0.02', to_task: 'T1', answer: '1.1' }, ...renames.map((x, k) => ({ ...x, ...cite(k) }))];
    const extra = { 'contracts/quality-loop/manifest.json': manifest(['QL-0.01', 'QL-0.02']), 'contracts/quality-loop/specs/QL-0.02.json': `${JSON.stringify(stub, null, 2)}\n` };
    return ev(sc({ snapshots: [v1, v2], disk: v2, rounds, extra, ...(record ? { record } : {}) }));
  };
  const noteText = 'the split renames the moved task for its new contract';
  const stubNotes = { reviewer_notes: [{ n: 1, text: noteText, sig: sign({ spec_id: 'QL-0.01', n: 1, text: noteText }, TEST_PRIV) }] };
  const uncited = intoStub(() => ({}));
  weakened(uncited, 'T2', null, 'uncited replacements renaming the moved task into a stub');
  assert.match(reason(uncited, 'never_weakens'), /task T2 removed and its move is refused: QL-0\.02 T1 lacks the requirement "b refuses a cycle"/);
  weakened(intoStub((k) => (k === 3 ? {} : { note: '1.2' })), 'T2', null, 'one of the four replacements uncited');
  signable(intoStub(() => ({ note: '1.2' })), 'each replacement citing a note point of the previous round');
  // requirement 6: a cited answer concerns the change, so answer 1.1, of task T1, carries out no replacement for the moved task T2
  weakened(intoStub(() => ({ answer: '1.1' })), 'T2', null, 'each replacement citing an added answer of another task');
  signable(intoStub(() => ({ reviewer_note: 1 }), stubNotes), 'each replacement citing a reviewer note');
  weakened(taskMove({ requirements: ['c prints a banner'], criteria: [{ statement: 'c prints a banner', verifier: { type: 'grep', file: 'src/c.mjs', pattern: 'banner' } }] }), 'T2', null, 'the receiving task is an unrelated stub');
});

test('T1-c43: a stop decision whose key is under contracts/keys/ only in the working tree is refused with stop_decision; with the key committed it is SIGNABLE AT STOP', () => {
  const s = threeRounds(); const key = contractKey(s.dir);
  stopWith(s, key);
  const r = ev(s);
  refused(r, 'stop_decision', 'the key not committed');
  assert.match(reason(r, 'stop_decision'), /not committed/);
  s.commit('the contract key and the stop decision');
  const c = ev(s);
  assert.equal(c.status, 'SIGNABLE AT STOP', c.reasons.join(' | '));
});

test('T1-c44: a stop over a spec that rewrites a round 3 statement is SIGNABLE AT STOP with a stop amendment citing an added round 3 answer; without it, or citing an answer not added, never_weakens; edited after signing, stop_decision', () => {
  const OLD = 'b answers fast'; const NEW = 'b answers within 50 ms';
  const disk = specV2(); disk.tasks[1].criteria[2].statement = NEW;
  // the cited answer concerns the criterion as it was (requirement 6) and is folded as the criterion now on disk
  const a3 = { n: 3, severity: 'medium', how: 'the statement does not say how fast', criterion: { task: 'T2', ...clone(specV2().tasks[1].criteria[2]) }, disposition: 'added', folded_as: { task: 'T2', ...clone(disk.tasks[1].criteria[2]) } };
  const make = (amendments) => {
    const s = threeRounds({ disk, answers3: [a3] }); const key = contractKey(s.dir);
    stopWith(s, key, amendments ? { amendments } : {}); s.commit('the stop decision and its key');
    return s;
  };
  const entry = { task: 'T2', field: 'statement', from: OLD, to: NEW, answer: '3.3' };
  const ok = ev(make([entry]));
  assert.equal(ok.status, 'SIGNABLE AT STOP', ok.reasons.join(' | '));
  const none = ev(make());
  refused(none, 'never_weakens', 'no stop amendment');
  assert.match(reason(none, 'never_weakens'), /the spec on disk: task T2 criterion "b answers fast"/);
  refused(ev(make([{ ...entry, answer: '3.1' }])), 'never_weakens', 'citing a round 3 answer that is not added');
  const edited = make([entry]);
  edited.mutate((r) => { r.stop.amendments[0].answer = '3.2'; }, { sign: false });
  refused(ev(edited), 'stop_decision', 'the stop amendment edited after the stop was signed');
});

test('T1-c45: a reworded requirement, a rewritten statement and a changed timeout_s, expect_exit or test_file are SIGNABLE with a cited amendment entry and refused without one; a scope glob needs an added answer that reads under it', () => {
  const OLDR = 'src/a.mjs exports a'; const NEWR = 'src/a.mjs exports a and nothing else';
  const changes = {
    requirement: [(v) => { v.tasks[0].requirements[0] = NEWR; }, { task: 'T1', field: 'requirement', from: OLDR, to: NEWR }, 'T1'],
    statement: [(v) => { v.tasks[1].criteria[2].statement = 'b answers in under 50 ms'; }, { task: 'T2', field: 'statement', from: 'b answers fast', to: 'b answers in under 50 ms' }, 'T2'],
    timeout_s: [(v) => { v.tasks[0].criteria[2].verifier.timeout_s = 600; }, { task: 'T1', field: 'verifier.timeout_s', statement: 'the tests of a pass', from: 300, to: 600 }, 'T1'],
    expect_exit: [(v) => { v.tasks[1].criteria[3].verifier.expect_exit = 1; }, { task: 'T2', field: 'verifier.expect_exit', statement: 'the lint passes', from: 0, to: 1 }, 'T2'],
    test_file: [(v) => { v.tasks[0].criteria[0].verifier.test_file = 'test/a2.test.mjs'; }, { task: 'T1', field: 'verifier.test_file', statement: 'T1-c01: the test of a fails on the base and passes now', from: 'test/a.test.mjs', to: 'test/a2.test.mjs' }, 'T1'],
  };
  const notes = (key) => { const text = 'the change carries out round 1 answer 1'; return [{ n: 1, text, sig: sign({ spec_id: 'QL-0.01', n: 1, text }, key) }]; };
  // a cited answer concerns the change (requirement 6): for a criterion, round 1 answer 3, whose criterion is the changed one as
  // it was, folded as it is now; for the requirement of T1, answer 1, of task T1
  const changed = (what, v2) => { const at = { statement: [1, 2], timeout_s: [0, 2], expect_exit: [1, 3], test_file: [0, 0] }[what]; return at && { task: `T${at[0] + 1}`, before: specV1().tasks[at[0]].criteria[at[1]], after: v2.tasks[at[0]].criteria[at[1]] }; };
  const cite = (what) => (changed(what, specV2()) ? '1.3' : '1.1');
  const twoRound = (change, amendments, record, what) => {
    const v2 = specV2(); change(v2); const rounds = baseRounds(); rounds[1].amendments = amendments;
    const c = changed(what, v2);
    if (c) rounds[0].answers.push({ n: 3, severity: 'medium', how: 'the criterion needs this change', criterion: { task: c.task, ...clone(c.before) }, disposition: 'added', folded_as: { task: c.task, ...clone(c.after) } });
    return ev(sc({ snapshots: [specV1(), v2], disk: v2, rounds, ...(record ? { record } : {}) }));
  };
  const viaImpl = (change, amendment, what) => {
    const v3 = specV2(); change(v3);
    const c = changed(what, v3);
    const about = c ? { task: c.task, ...clone(c.before) } : { task: 'T1', ...clone(specV2().tasks[0].criteria[1]) };
    const rounds = [baseRounds()[0], { kind: 'implementation', verdict: 'findings', answers: [{ n: 1, severity: 'medium', how: 'the code shows the text is wrong', criterion: about, disposition: 'added' }] }, { ...baseRounds()[1], amendments: [{ ...amendment, answer: '2.1' }] }];
    return ev(sc({ snapshots: [specV1(), null, v3], disk: v3, rounds }));
  };
  for (const [what, [change, am, task]] of Object.entries(changes)) {
    signable(twoRound(change, [{ ...am, answer: cite(what) }], undefined, what), `${what}: citing an added answer of the previous round`);
    signable(twoRound(change, [{ ...am, note: '1.2' }]), `${what}: citing a note point of the previous round`);
    signable(viaImpl(change, am, what), `${what}: citing an answer of an implementation round recorded after it`);
    signable(twoRound(change, [{ ...am, reviewer_note: 1 }], { reviewer_notes: notes(TEST_PRIV) }), `${what}: citing a reviewer note`);
    weakened(twoRound(change, []), task, null, `${what}: no entry`);
    weakened(twoRound(change, [{ ...am, from: `${am.from}x`, answer: cite(what) }], undefined, what), task, null, `${what}: a from that is not the earlier text`);
    weakened(twoRound(change, [{ ...am, answer: '2.1' }]), task, null, `${what}: citing an answer of the round itself`);
    weakened(twoRound(change, [{ ...am, answer: '1.2' }]), task, null, `${what}: citing an answer that is not added`);
    weakened(twoRound(change, [{ ...am }]), task, null, `${what}: citing nothing`);
    weakened(twoRound(change, [{ ...am, reviewer_note: 1 }], { reviewer_notes: notes(generateKeyPair().privateKey) }), task, null, `${what}: a reviewer note signed by a key outside REVIEWER_KEYS`);
  }
  // an implementation round's answer is a citation only for a spec round recorded after that implementation round
  const [rchange, ram, rtask] = changes.requirement;
  const ordered = (citeIn) => {
    const v = specV2(); rchange(v);
    const cite = [{ ...ram, answer: '3.1' }];
    const impl = { kind: 'implementation', verdict: 'findings', answers: [{ n: 1, severity: 'medium', how: 'the code shows the text is wrong', criterion: { task: 'T1', ...clone(specV2().tasks[0].criteria[1]) }, disposition: 'added' }] };
    const rounds = [baseRounds()[0], { verdict: 'findings', answers: [], ...(citeIn === 2 ? { amendments: cite } : {}) }, impl, { ...baseRounds()[1], ...(citeIn === 4 ? { amendments: cite } : {}) }];
    return ev(sc({ snapshots: citeIn === 2 ? [specV1(), v, null, v] : [specV1(), specV2(), null, v], disk: v, rounds }));
  };
  weakened(ordered(2), rtask, null, 'round 2 citing an answer of implementation round 3, recorded after it');
  signable(ordered(4), 'round 4 citing an answer of implementation round 3, recorded before it');
  // a command change cites like any other change: a reviewer note that says the command was narrowed needs no other word
  const NARROW = "node --test --test-name-pattern='^a ' test/a.test.mjs";
  const narrowed = (text) => {
    const v2 = specV2(); v2.tasks[0].criteria[2].verifier.cmd = NARROW;
    const rounds = baseRounds(); rounds[1].amendments = [{ task: 'T1', field: 'verifier.cmd', statement: 'the tests of a pass', from: 'node --test test/a.test.mjs', to: NARROW, reviewer_note: 1 }];
    return ev(sc({ snapshots: [specV1(), v2], disk: v2, rounds, record: { reviewer_notes: [{ n: 1, text, sig: sign({ spec_id: 'QL-0.01', n: 1, text }, TEST_PRIV) }] } }));
  };
  signable(narrowed('the build narrowed the command to its own labelled subtest'), 'a narrowed command cited by a reviewer note that says narrowed');
  // a scope glob: the entry cites an added answer of the previous round whose criterion reads a path under it
  const crit = { statement: 'T1-c06: a handles a new case', verifier: { type: 'test_red_green', test_file: 'test/new/x.test.mjs', cmd: 'node --test test/new/x.test.mjs' } };
  const glob = (amendments) => {
    const v2 = specV2(); v2.tasks[0].scope.push('test/new/**'); v2.tasks[0].criteria.splice(4, 0, clone(crit));
    const rounds = baseRounds(); rounds[0].answers.push({ n: 3, severity: 'medium', how: 'a new case is untested', criterion: { task: 'T1', ...clone(crit) }, disposition: 'added' }); rounds[1].amendments = amendments;
    return ev(sc({ snapshots: [specV1(), v2], disk: v2, rounds }));
  };
  signable(glob([{ task: 'T1', field: 'scope', to: 'test/new/**', answer: '1.3' }]), 'a glob citing an added answer that reads test/new/x.test.mjs');
  weakened(glob([]), 'T1', null, 'a glob with no entry');
  weakened(glob([{ task: 'T1', field: 'scope', to: 'test/new/**', answer: '1.1' }]), 'T1', null, 'a glob citing an answer that reads nothing under it');
  weakened(glob([{ task: 'T1', field: 'scope', to: 'test/new/**', note: '1.1' }]), 'T1', null, 'a glob citing a note');
  // the cited answer is judged by the criterion it became: its folded_as, not the raw proposal
  const foldedGlob = (raw, fa) => {
    const v2 = specV2(); v2.tasks[0].scope.push('test/new/**'); v2.tasks[0].criteria.splice(4, 0, clone(crit));
    const rounds = baseRounds(); rounds[0].answers.push({ n: 3, severity: 'medium', how: 'a new case is untested', criterion: { task: 'T1', ...clone(raw) }, disposition: 'added', folded_as: { task: 'T1', ...clone(fa) } }); rounds[1].amendments = [{ task: 'T1', field: 'scope', to: 'test/new/**', answer: '1.3' }];
    return ev(sc({ snapshots: [specV1(), v2], disk: v2, rounds }));
  };
  const rawA = { statement: 'a handles a new case', verifier: { type: 'test_red_green', test_file: 'test/a.test.mjs', cmd: 'node --test test/a.test.mjs' } };
  signable(foldedGlob(rawA, crit), 'the proposal reads test/a.test.mjs, the criterion it was folded as reads test/new/x.test.mjs');
  weakened(foldedGlob(crit, specV2().tasks[0].criteria[3]), 'T1', null, 'the proposal reads under the glob, the criterion it was folded as does not');
  // one path added through the field form cites like any change; the landed scope_add form keeps its own rule
  const onePath = (am, record) => { const v2 = specV2(); v2.tasks[0].scope.push('docs/a.md'); const rounds = baseRounds(); rounds[1].amendments = [am]; return ev(sc({ snapshots: [specV1(), v2], disk: v2, rounds, ...(record ? { record } : {}) })); };
  signable(onePath({ task: 'T1', field: 'scope', to: 'docs/a.md', reviewer_note: 1 }, { reviewer_notes: notes(TEST_PRIV) }), 'one path in the field form citing a reviewer note');
  signable(onePath({ task: 'T1', field: 'scope', to: 'docs/a.md', note: '1.2' }), 'one path in the field form citing a note point');
  weakened(onePath({ task: 'T1', scope_add: 'docs/a.md', reviewer_note: 1 }, { reviewer_notes: notes(TEST_PRIV) }), 'T1', null, 'the scope_add form citing a reviewer note');
});

const omit = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
/** A test Vault that has signed one contract, so the key its contractSign uses exists: { v, root, priv, pub, id }. */
function testVault() {
  const { root, v } = newVault();
  const d = v.contractDraft(OWNER, { title: 'A contract the test vault signs', tasks: [{ id: 'T1', title: 'a file', scope: ['**'], criteria: [{ statement: 'a file exists', verifier: { type: 'file_exists', path: 'a.txt' } }] }] });
  const s = v.contractSign(OWNER, { id: d.id });
  return { v, root, priv: fs.readFileSync(path.join(root, '..', 'keys', 'contract-ed25519.pem'), 'utf8'), pub: fs.readFileSync(path.join(root, 'contracts', 'keys', `${s.keyid}.pub`), 'utf8'), id: s.keyid };
}

/** contracts/quality-loop/manifest.json naming these spec ids. */
const manifestOf = (ids) => `${JSON.stringify({ schema: 'memev-quality-loop/1', contracts: ids.map((id) => ({ id, kind: 'feature' })) }, null, 2)}\n`;
const asJson = (v) => `${JSON.stringify(v, null, 2)}\n`;
const NOWHERE = path.join(os.tmpdir(), 'redteam-no-snapshots-here');
/**
 * QL-0.02 beside the fixture spec, as `extra` files for scenario(): its manifest row, its spec (task T2 of the fixture as its T1,
 * changed by `recv`) and, when `rounds` is given, its record signed by `priv` and then changed by `tamper`.
 */
function receiving({ recv = () => {}, rounds, priv = TEST_PRIV, tamper = () => {} } = {}) {
  const t = clone({ ...specV2().tasks[1], id: 'T1', depends_on: [] });
  recv(t);
  const files = { 'contracts/quality-loop/manifest.json': manifestOf(['QL-0.01', 'QL-0.02']), 'contracts/quality-loop/specs/QL-0.02.json': asJson({ ...specV2(), title: 'QL-0.02 The receiving contract', tasks: [t] }) };
  if (rounds) { const rec = signRecord({ schema: 'memev-redteam/1', spec_id: 'QL-0.02', rounds: clone(rounds) }, NOWHERE, priv, { id: 'QL-0.02' }); tamper(rec); files['contracts/quality-loop/redteam/QL-0.02.json'] = asJson(rec); }
  return files;
}
const answerOf = (n, how, criterion, extra = {}) => ({ n, severity: 'medium', how, criterion, disposition: 'added', ...extra });

const STOP_RULE = specV2().tasks[1].stop_rules[0];
/** T2's three kinds of removable item: the entry field, the removed text and how the item is dropped from a task. */
const ITEMS = {
  criterion: { field: 'criterion', text: 'the lint passes', drop: (t) => { t.criteria = t.criteria.filter((c) => c.statement !== 'the lint passes'); }, rename: (t, to) => { t.criteria.find((c) => c.statement === 'the lint passes').statement = to; }, chain: 'statement' },
  requirement: { field: 'requirement', text: 'src/b.mjs re-exports a', drop: (t) => { t.requirements = t.requirements.filter((q) => q !== 'src/b.mjs re-exports a'); }, rename: (t, to) => { t.requirements = [to]; }, chain: 'requirement' },
  stop_rule: { field: 'stop_rule', text: STOP_RULE, drop: (t) => { t.stop_rules = t.stop_rules.filter((s) => s !== STOP_RULE); }, rename: (t, to) => { t.stop_rules = [to]; }, chain: 'stop_rule' },
};
/** Item removed from T2 between r1 and r2, with `entries` in r2's amendments; how (round 1 answer 1), notes, reviewer notes and extra files as given. */
function removedItem(item, entries, { how, notes, reviewerNotes, extra } = {}) {
  const v2 = specV2(); item.drop(v2.tasks[1]);
  const rounds = baseRounds();
  if (how) rounds[0].answers[0].how = how;
  if (notes) rounds[0].notes = notes;
  rounds[1].amendments = entries;
  return ev(sc({ snapshots: [specV1(), v2], disk: v2, rounds, ...(extra ? { extra } : {}), ...(reviewerNotes ? { record: { reviewer_notes: reviewerNotes } } : {}) }));
}
const noteBy = (n, text, priv = TEST_PRIV) => ({ n, text, sig: sign({ spec_id: 'QL-0.01', n, text }, priv) });

test('T1-c46: a removed criterion, requirement or stop rule is SIGNABLE with a removal entry whose citation quotes it and names it contradictory or impossible, or with a move entry to a spec that holds it; refused without, with a citation that does not quote it or name it so, or a move whose receiving spec lacks it', () => {
  for (const [what, item] of Object.entries(ITEMS)) {
    const q = `'${item.text}'`;
    const removal = (cite) => [{ task: 'T2', field: item.field, from: item.text, to: null, ...cite }];
    // each kind of citation requirement 11 allows: an answer, a note point, a reviewer note, another spec's answer
    signable(removedItem(item, removal({ answer: '1.1' }), { how: `${q} contradicts T2's scope` }), `${what}: an answer that quotes it and names it contradictory`);
    signable(removedItem(item, removal({ note: '1.3' }), { notes: `1. T1 has no check that a refuses a missing input. 2. The grep of T1 is weak. 3. ${q} is impossible to meet.` }), `${what}: a note point that quotes it and names it impossible`);
    signable(removedItem(item, removal({ reviewer_note: 1 }), { reviewerNotes: [noteBy(1, `The build found ${q} contradictory: T2 cannot meet it.`)] }), `${what}: a reviewer note that quotes it and names it contradictory`);
    const other = (how) => receiving({ rounds: [{ round: 1, verdict: 'findings', answers: [answerOf(1, how, { task: 'T1', statement: 'x', verifier: { type: 'scope' } })] }] });
    signable(removedItem(item, removal({ answer: 'QL-0.02:1.1' }), { extra: other(`${q} contradicts the receiving task`) }), `${what}: another spec's answer that quotes it and names it contradictory`);
    // refused: no entry, a citation that does not quote it, one that quotes it without naming it contradictory or impossible
    weakened(removedItem(item, []), 'T2', null, `${what}: no entry`);
    weakened(removedItem(item, removal({ answer: '1.1' }), { how: "'the module b' contradicts T2's scope" }), 'T2', null, `${what}: an answer that does not quote it`);
    weakened(removedItem(item, removal({ answer: '1.1' }), { how: `${q} is slow to check` }), 'T2', null, `${what}: an answer that quotes it without naming it contradictory or impossible`);
    weakened(removedItem(item, removal({ note: '1.3' }), { notes: `1. T1 has no check that a refuses a missing input. 2. The grep of T1 is weak. 3. ${q} is slow to check.` }), 'T2', null, `${what}: a note point that quotes it without naming it contradictory or impossible`);
    weakened(removedItem(item, removal({ reviewer_note: 1 }), { reviewerNotes: [noteBy(1, "The build found 'the module b' contradictory.")] }), 'T2', null, `${what}: a reviewer note that does not quote it`);
    weakened(removedItem(item, removal({ answer: 'QL-0.02:1.1' }), { extra: other("'the module b' is impossible") }), 'T2', null, `${what}: another spec's answer that does not quote it`);
    // a move entry: the receiving spec holds it verbatim, or as the end of its own recorded replacements, or lacks it
    const move = [{ kind: 'move', task: 'T2', field: item.field, from: item.text, to_spec: 'QL-0.02', to_task: 'T1', answer: '1.1' }];
    signable(removedItem(item, move, { extra: receiving() }), `${what}: moved to QL-0.02 T1, which holds it`);
    const renamed = `${item.text} (in QL-0.02)`;
    const replaced = receiving({ recv: (t) => item.rename(t, renamed), rounds: [{ round: 1, verdict: 'findings', answers: [], amendments: [{ task: 'T1', field: item.chain, from: item.text, to: renamed, answer: '1.1' }] }] });
    signable(removedItem(item, move, { extra: replaced }), `${what}: moved to QL-0.02 T1, which holds it after its own recorded replacement`);
    const lacks = removedItem(item, move, { extra: receiving({ recv: item.drop }) });
    weakened(lacks, 'T2', null, `${what}: moved to QL-0.02 T1, which lacks it`);
    assert.match(reason(lacks, 'never_weakens'), /its move is refused: QL-0\.02 T1 lacks the/, what);
  }
  // a whole task moved: the receiving task holds every item of it, or the move is refused
  const taskMoved = (extra) => { const v2 = specV2(); v2.tasks = [v2.tasks[0]]; const rounds = baseRounds(); rounds[1].amendments = [{ kind: 'move', task: 'T2', to_spec: 'QL-0.02', to_task: 'T1', answer: '1.1' }]; return ev(sc({ snapshots: [specV1(), v2], disk: v2, rounds, extra })); };
  signable(taskMoved(receiving()), 'task T2 moved whole to QL-0.02 T1');
  weakened(taskMoved(receiving({ recv: ITEMS.criterion.drop })), 'T2', null, 'task T2 moved whole to a task that lacks one of its criteria');
});

test('T1-c47: a citation of another spec\'s answer, <spec>:<round>.<n>, is accepted when the manifest resolves the id to a record holding that round and answer; an id the manifest does not resolve, a path, or a missing round or answer is refused with never_weakens', () => {
  const NEWR = 'src/a.mjs exports a and nothing else';
  const make = (answer, { ids = ['QL-0.01', 'QL-0.02'], record = true } = {}) => {
    const v2 = specV2(); v2.tasks[0].requirements[0] = NEWR;
    const rounds = baseRounds(); rounds[1].amendments = [{ task: 'T1', field: 'requirement', from: 'src/a.mjs exports a', to: NEWR, answer }];
    const extra = receiving(record ? { rounds: [{ round: 1, verdict: 'findings', answers: [answerOf(1, 'the requirement says too little', { task: 'T1', ...clone(specV2().tasks[0].criteria[1]) })] }] } : {});
    extra['contracts/quality-loop/manifest.json'] = manifestOf(ids);
    return ev(sc({ snapshots: [specV1(), v2], disk: v2, rounds, extra }));
  };
  signable(make('QL-0.02:1.1'), 'the id resolved through the manifest to a record holding round 1 answer 1');
  for (const [what, answer, o] of [
    ['an id the manifest does not resolve', 'QL-0.02:1.1', { ids: ['QL-0.01'] }],
    ['the record path instead of an id', 'contracts/quality-loop/redteam/QL-0.02.json:1.1'],
    ['the spec path instead of an id', 'contracts/quality-loop/specs/QL-0.02.json:1.1'],
    ['a round the record does not hold', 'QL-0.02:2.1'],
    ['an answer the round does not hold', 'QL-0.02:1.9'],
    ['a spec with no record', 'QL-0.02:1.1', { record: false }],
  ]) {
    const r = make(answer, o);
    weakened(r, 'T1', null, what);
    assert.match(reason(r, 'never_weakens'), /requirement removed or reworded: "src\/a\.mjs exports a" and its amendment is refused: its answer/, what);
  }
});

test('T1-c48: the gate holds STOP_KEYS, none of them a key the engine\'s contract signing makes; a stop signed by a fresh key whose .pub is committed, or by a test Vault\'s contract key, is refused with stop_decision; signed by a key passed as stopKeys and committed it is SIGNABLE AT STOP', () => {
  assert.equal(G.STOP_KEYS.length, 1);
  assert.equal(keyId(G.STOP_KEYS[0]), '55fada3548cc507e');
  const stopIds = new Set(G.STOP_KEYS.map(keyId));
  assert.ok(!REVIEWER_KEYS.some((k) => stopIds.has(keyId(k))), 'no reviewer key is a stop key');
  // every key that signed a contract of this repository came from the engine's contract signing: none is a stop key
  const signedBy = fs.readdirSync(path.join(ROOT, 'contracts', 'signed')).filter((n) => n.endsWith('.sig.json')).map((n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts', 'signed', n), 'utf8')).signatures[0].keyid);
  assert.ok(signedBy.length > 0);
  for (const kid of signedBy) assert.ok(!stopIds.has(kid), `contract key ${kid} is not a stop key`);
  const tv = testVault();
  assert.ok(!stopIds.has(tv.id), 'the key a test Vault signs contracts with is not a stop key');
  // a fresh key committed with the stop, and committed before it
  const same = threeRounds(); const k1 = contractKey(same.dir);
  same.mutate((r) => { r.stop = stopDecision(r, same.disk(), k1.privateKey); }); same.commit('the stop and its key together');
  const r1 = ev(same);
  refused(r1, 'stop_decision', 'a fresh key committed in the same commit as the stop');
  assert.match(reason(r1, 'stop_decision'), /not a stop key the gate accepts/);
  const earlier = threeRounds(); const k2 = contractKey(earlier.dir); earlier.commit('a contract key');
  earlier.mutate((r) => { r.stop = stopDecision(r, earlier.disk(), k2.privateKey); }); earlier.commit('the stop');
  refused(ev(earlier), 'stop_decision', 'a fresh key committed before the stop');
  // the key a test Vault's contractSign used, its .pub committed
  const byVault = threeRounds();
  byVault.write(`contracts/keys/${tv.id}.pub`, tv.pub);
  byVault.mutate((r) => { r.stop = stopDecision(r, byVault.disk(), tv.priv); }); byVault.commit('the stop by the vault key');
  refused(ev(byVault), 'stop_decision', 'the key a test Vault signed a contract with');
  // the same stop by a key passed as stopKeys, committed under contracts/keys/
  const ok = threeRounds(); const k3 = contractKey(ok.dir);
  stopWith(ok, k3); ok.commit('the stop and its key');
  const r3 = ev(ok);
  assert.equal(r3.status, 'SIGNABLE AT STOP', r3.reasons.join(' | '));
  refused(ev(ok, { stopKeys: undefined }), 'stop_decision', 'the same stop judged with STOP_KEYS');
  tv.v.close();
});

test('T1-c49: a high answer of the clean last round made medium in a later commit, and r2 relabelled kind implementation with spec v1 restored, each re-signed with the same reviewer key, is NOT SIGNABLE with review_sig naming round 2; the same record committed with no earlier version is SIGNABLE', () => {
  const high = { n: 1, severity: 'high', how: 'a hole in the check', disposition: 'rejected', reason: 'the check is the base test' };
  const severity = (sev, o = {}) => sc({ rounds: [baseRounds()[0], { verdict: 'clean', answers: [{ ...clone(high), severity: sev }] }], ...o });
  const s = severity('high');
  refused(ev(s), 'last_high', 'the committed record');
  s.mutate((r) => { r.rounds[1].answers[0].severity = 'medium'; });
  s.commit('the answer made medium, every round and the closing envelope signed again');
  const r = ev(s);
  refused(r, 'review_sig', 'severity edited and re-signed');
  assert.match(reason(r, 'review_sig'), /round 2 in .* differs from the version .* first committed/);
  signable(ev(severity('medium')), 'the edited record committed with no earlier version');
  const v1 = specV2(); const v2 = specV2(); v2.tasks[1].criteria.splice(1, 0, { statement: 'T2-c08: b refuses a cycle', verifier: { type: 'test_red_green', test_file: 'test/b.test.mjs', cmd: 'node --test test/b.test.mjs' } });
  const rounds = [{ verdict: 'clean', answers: [], manifest_kind: 'feature' }, { verdict: 'clean', answers: [clone(high)] }];
  const k = sc({ snapshots: [v1, v2], rounds });
  k.mutate((x) => { x.rounds[1].kind = 'implementation'; });
  k.setDisk(v1);
  k.commit('r2 relabelled kind implementation, spec v1 restored, every round signed again');
  const rk = ev(k);
  refused(rk, 'review_sig', 'r2 relabelled and re-signed');
  assert.match(reason(rk, 'review_sig'), /round 2 is of kind implementation in .* but of kind spec in/);
  signable(ev(sc({ snapshots: [v1, v2], disk: v1, rounds: [rounds[0], { ...clone(rounds[1]), kind: 'implementation' }] })), 'the relabelled record committed with no earlier version');
});

test('T1-c50: a stop that is a contract body signed through v.contractSign, with its .sig.json, is refused with stop_decision; a stop is accepted only with exactly its own fields and its own payload type', () => {
  const tv = testVault();
  const s = threeRounds();
  const proper = omit(stopDecision(s.record(), s.disk(), tv.priv), ['sig']);
  // a memev_write draft of one valid task plus the stop's fields, signed by the test Vault
  const id = 'k-a-stop-decision-abc123';
  const draft = { ...skeleton('memev'), id, title: 'A stop decision as a contract', workdir: null, created: '2026-10-31T00:00:00Z', version: 1, tasks: [makeTask({ id: 'T1', title: 'a file', phase: 'implement', depends_on: [], requirements: [], description: '', scope: ['**'], criteria: [{ statement: 'a file exists', verifier: { type: 'file_exists', path: 'a.txt' } }], stop_rules: [] })], ...proper };
  tv.v.write(OWNER, { path: `contracts/drafts/${id}.json`, body: asJson(draft) });
  const signed = tv.v.contractSign(OWNER, { id });
  assert.equal(signed.keyid, tv.id);
  const body = JSON.parse(fs.readFileSync(path.join(tv.root, 'contracts', 'signed', `${id}.json`), 'utf8'));
  const env = JSON.parse(fs.readFileSync(path.join(tv.root, 'contracts', 'signed', `${id}.sig.json`), 'utf8'));
  s.write(`contracts/keys/${tv.id}.pub`, tv.pub);
  s.mutate((r) => { r.stop = { ...body, sig: env }; }); s.commit('the contract body and its signature as the stop');
  const keys = { stopKeys: [tv.pub] };
  const asContract = ev(s, keys);
  refused(asContract, 'stop_decision', 'a contract body signed through v.contractSign, its key passed as a stop key');
  assert.match(reason(asContract, 'stop_decision'), /holds exactly spec_id, spec_sha256, decider, date, decision, open, dispositions/);
  assert.match(reason(asContract, 'stop_decision'), /payload type is "application\/vnd\.memev\.contract-sha256"/);
  refused(ev(s), 'stop_decision', 'the same, judged with STOP_KEYS');
  // the stop's own fields under the contract payload type, and under its own payload type with one field more
  const shaped = (stop) => { const t = threeRounds(); t.write(`contracts/keys/${tv.id}.pub`, tv.pub); t.mutate((r) => { r.stop = stop; }); t.commit('the stop'); return ev(t, keys); };
  const contractType = shaped({ ...proper, sig: sign(proper, tv.priv) });
  refused(contractType, 'stop_decision', 'exactly its fields, signed under the contract payload type');
  assert.match(reason(contractType, 'stop_decision'), /not the stop decision's own application\/vnd\.memev\.redteam-stop-sha256/);
  const more = { ...proper, note: 'one field more' };
  const extra = shaped({ ...more, sig: signAs(more, tv.priv) });
  refused(extra, 'stop_decision', 'its own payload type with a field more');
  assert.match(reason(extra, 'stop_decision'), /it holds note; a stop decision holds exactly/);
  const own = shaped({ ...proper, sig: signAs(proper, tv.priv, STOP_PAYLOAD) });
  assert.equal(own.status, 'SIGNABLE AT STOP', own.reasons.join(' | '));
  assert.equal(G.STOP_PAYLOAD_TYPE, STOP_PAYLOAD);
  tv.v.close();
});

test('T1-c51: a scope_add glob is refused; a glob in the field form passes only when cited added answers read every file it newly admits at the reviewed commit, or when a signed reviewer note quotes it; through a stop decision too', () => {
  const crit = { statement: 'T1-c09: a handles a new case', verifier: { type: 'test_red_green', test_file: 'test/new.test.mjs', cmd: 'node --test test/new.test.mjs' } };
  const otherCrit = { statement: 'T1-c10: a handles the other case', verifier: { type: 'test_red_green', test_file: 'test/other.test.mjs', cmd: 'node --test test/other.test.mjs' } };
  const files = { ...FILES, 'test/other.test.mjs': "import { test } from 'node:test';\n" };
  const withCrits = (g) => { const v = specV2(); v.tasks[0].criteria.splice(4, 0, clone(crit), clone(otherCrit)); if (g) v.tasks[0].scope.push(g); return v; };
  const r1 = { verdict: 'findings', answers: [answerOf(1, 'a new case is not tested', { task: 'T1', ...clone(crit) }), { n: 2, severity: 'low', how: 'the grep is weak', disposition: 'rejected', reason: 'it is a grep' }, answerOf(3, 'the other case is not tested', { task: 'T1', ...clone(otherCrit) })] };
  const make = (g, amendments, record) => ev(sc({ files, snapshots: [specV2(), withCrits(g)], rounds: [r1, { verdict: 'clean', answers: [], amendments }], ...(record ? { record } : {}) }));
  // the scope_add form names one path
  for (const g of ['**', 'src/**', 'test/**']) weakened(make(g, [{ task: 'T1', scope_add: g, answer: '1.1' }]), 'T1', null, `scope_add ${g}`);
  signable(make('test/new.test.mjs', [{ task: 'T1', scope_add: 'test/new.test.mjs', answer: '1.1' }]), 'scope_add test/new.test.mjs');
  // the field form: every file the glob newly admits at the reviewed commit is read by a cited added answer
  for (const g of ['**', 'src/**', 'test/**']) weakened(make(g, [{ task: 'T1', field: 'scope', to: g, answer: '1.1' }]), 'T1', null, `${g} backed by one reading answer`);
  const unread = make('test/*.test.mjs', [{ task: 'T1', field: 'scope', to: 'test/*.test.mjs', answer: '1.1' }]);
  weakened(unread, 'T1', null, 'test/*.test.mjs, test/other.test.mjs read by no cited answer');
  assert.match(reason(unread, 'never_weakens'), /admits 1 file\(s\) at the reviewed commit .* that no cited answer reads \(test\/other\.test\.mjs\)/);
  signable(make('test/*.test.mjs', [{ task: 'T1', field: 'scope', to: 'test/*.test.mjs', answer: '1.1' }, { task: 'T1', field: 'scope', to: 'test/*.test.mjs', answer: '1.3' }]), 'test/*.test.mjs, every file it admits read by a cited added answer');
  // or a signed reviewer note that quotes the glob
  const viaNote = (note, cite = { reviewer_note: 1 }) => make('test/**', [{ task: 'T1', field: 'scope', to: 'test/**', ...cite }], { reviewer_notes: [note] });
  signable(viaNote(noteBy(1, "The task's tests move under 'test/**'; at the reviewed commit it admits test/other.test.mjs.")), 'a reviewer note signed by a reviewer key that quotes test/**');
  weakened(viaNote(noteBy(1, 'The tests move under test/.')), 'T1', null, 'a signed note that does not contain test/**');
  weakened(viaNote(noteBy(1, "The tests move under 'test/**'."), { note: '1.2' }), 'T1', null, 'a note point of round 1 instead');
  weakened(viaNote(noteBy(1, "The tests move under 'test/**'.", generateKeyPair().privateKey)), 'T1', null, 'a note signed by a key outside the reviewer keys');
  // through a stop decision's amendments
  const atStop = (g, amendments, record) => {
    const base = withCrits(); const disk = withCrits(g);
    const rounds = [{ verdict: 'findings', answers: [{ n: 1, severity: 'high', how: 'a hole', disposition: 'rejected', reason: 'the check is the base test' }] }, { verdict: 'findings', answers: [] }, { verdict: 'findings', answers: [answerOf(1, 'a new case is not tested', { task: 'T1', ...clone(crit) })] }];
    const s = sc({ files, snapshots: [base, base, base], disk, rounds, ...(record ? { record } : {}) });
    stopWith(s, contractKey(s.dir), { amendments }); s.commit('the stop and its key');
    return ev(s);
  };
  weakened(atStop('**', [{ task: 'T1', scope_add: '**', answer: '3.1' }]), 'T1', null, 'scope_add ** through the stop');
  weakened(atStop('**', [{ task: 'T1', field: 'scope', to: '**', answer: '3.1' }]), 'T1', null, '** in the field form through the stop, backed by one reading answer');
  const noted = atStop('test/**', [{ task: 'T1', field: 'scope', to: 'test/**', reviewer_note: 1 }], { reviewer_notes: [noteBy(1, "'test/**' admits test/other.test.mjs.")] });
  assert.equal(noted.status, 'SIGNABLE AT STOP', noted.reasons.join(' | '));
});

test('T1-c52: a timeout or statement change citing an added answer about another criterion is refused with never_weakens; citing an answer of the same task whose criterion has the statement before the change is SIGNABLE whatever it proposes; the same through a stop decision', () => {
  const ST = 'the tests of a pass'; const NEW = 'the tests of a pass on node 23';
  const changes = {
    timeout_s: [(c) => { c.verifier.timeout_s = 3000; }, { task: 'T1', field: 'verifier.timeout_s', statement: ST, from: 300, to: 3000 }],
    statement: [(c) => { c.statement = NEW; }, { task: 'T1', field: 'statement', from: ST, to: NEW }],
  };
  const changedSpec = (change) => { const v = specV2(); change(v.tasks[0].criteria[2]); return v; };
  // answer 1 concerns the criterion as it was and proposes another timeout; it is folded as the criterion now on disk
  const about = (v) => answerOf(1, 'the timeout is too short', { task: 'T1', statement: ST, verifier: { type: 'command', cmd: 'node --test test/a.test.mjs', timeout_s: 600 } }, { folded_as: { task: 'T1', ...clone(v.tasks[0].criteria[2]) } });
  const elsewhere = answerOf(2, 'the grep should stay', { task: 'T1', ...clone(specV2().tasks[0].criteria[1]) });
  for (const [what, [change, am]] of Object.entries(changes)) {
    const v = changedSpec(change);
    const make = (answer) => ev(sc({ snapshots: [specV2(), v], disk: v, rounds: [{ verdict: 'findings', answers: [about(v), elsewhere] }, { verdict: 'clean', answers: [], amendments: [{ ...am, answer }] }] }));
    const r = make('1.2');
    weakened(r, 'T1', ST, `${what}: citing answer 1.2, whose criterion is src/a.mjs exports a`);
    assert.match(reason(r, 'never_weakens'), /answer 1\.2 concerns the criterion "src\/a\.mjs exports a", not "the tests of a pass"/, what);
    signable(make('1.1'), `${what}: citing answer 1.1, of task T1 and the statement before the change, which proposes timeout_s 600`);
    // the stop's amendments, citing an added round 3 answer
    const atStop = (answers3, answer) => {
      const rounds = [{ verdict: 'findings', answers: [{ n: 1, severity: 'high', how: 'a hole', disposition: 'rejected', reason: 'the check is the base test' }] }, { verdict: 'findings', answers: [] }, { verdict: 'findings', answers: answers3 }];
      const s = sc({ snapshots: [specV2(), specV2(), specV2()], disk: v, rounds });
      stopWith(s, contractKey(s.dir), { amendments: [{ ...am, answer }] }); s.commit('the stop and its key');
      return ev(s);
    };
    weakened(atStop([about(v), elsewhere], '3.2'), 'T1', ST, `${what}: through the stop, citing round 3 answer 2 about another criterion`);
    const ok = atStop([about(v), elsewhere], '3.1');
    assert.equal(ok.status, 'SIGNABLE AT STOP', `${what}: through the stop, citing round 3 answer 1 about it: ${ok.reasons.join(' | ')}`);
  }
});

test('T1-c53: removing T2\'s criterion \'the lint passes\' citing note point 2 is refused unless the point quotes it and names it contradictory or impossible, not negated; citing a signed reviewer note it is SIGNABLE when the note quotes it, without calling it contradictory or impossible', () => {
  const lint = clone(specV2().tasks[1].criteria[3]);
  const make = (point) => removedItem(ITEMS.criterion, [{ task: 'T2', field: 'criterion', from: lint, to: null, note: '1.2' }], { notes: `1. T1 has no check that a refuses a missing input. 2. ${point}` });
  weakened(make('The grep of T1 is weak but not contradictory.'), 'T2', 'the lint passes', 'a point that neither quotes it nor names it contradictory');
  weakened(make('b answers fast is impossible to measure'), 'T2', 'the lint passes', 'a point that names another criterion impossible');
  weakened(make("'the lint passes' is not contradictory"), 'T2', 'the lint passes', 'a point that quotes it and negates contradictory');
  weakened(make("'the lint passes' is never impossible to meet"), 'T2', 'the lint passes', 'a point that quotes it and negates impossible');
  weakened(make("'the lint passes' is slow to check"), 'T2', 'the lint passes', 'a point that quotes it without naming it contradictory or impossible');
  signable(make("'the lint passes' contradicts T2's scope"), 'a point that quotes it and names it contradictory');
  // a signed reviewer note that quotes it and names the added answer that carries it; the gate checks the quote
  const CARRIED = "'the lint passes' is carried by round 1 answer 1, which was added.";
  assert.doesNotMatch(CARRIED, /contradict|impossib/i);
  const viaNote = (note) => removedItem(ITEMS.criterion, [{ task: 'T2', field: 'criterion', from: lint, to: null, reviewer_note: 1 }], { reviewerNotes: [note] });
  signable(viaNote(noteBy(1, CARRIED)), 'a reviewer note signed by a reviewer key that quotes it and names the answer that carries it');
  weakened(viaNote(noteBy(1, 'The lint check is carried by round 1 answer 1, which was added.')), 'T2', 'the lint passes', 'a signed reviewer note that does not quote it');
  weakened(viaNote(noteBy(1, CARRIED, generateKeyPair().privateKey)), 'T2', 'the lint passes', 'a reviewer note signed by a key outside the reviewer keys');
  // the same through a stop decision's amendments
  const atStop = (text) => {
    const disk = specV2(); ITEMS.criterion.drop(disk.tasks[1]);
    const s = threeRounds({ disk });
    s.mutate((r) => { r.reviewer_notes = [noteBy(1, text)]; });
    stopWith(s, contractKey(s.dir), { amendments: [{ task: 'T2', field: 'criterion', from: 'the lint passes', to: null, reviewer_note: 1 }] }); s.commit('the stop and its key');
    return ev(s);
  };
  const ok = atStop(CARRIED);
  assert.equal(ok.status, 'SIGNABLE AT STOP', ok.reasons.join(' | '));
  weakened(atStop('The lint check is carried by round 1 answer 1.'), 'T2', 'the lint passes', 'through the stop, a signed reviewer note that does not quote it');
});

test('T1-c54: a test_red_green that only names its test file (test -f, cat, grep, true) is refused with red_green_required; one that runs it under node --test, or {test}, is SIGNABLE', () => {
  const rg = (cmd) => { const s = oneTask(); s.tasks[0].criteria[0].verifier = { type: 'test_red_green', test_file: 'test/a.test.mjs', cmd }; return ev(sc({ snapshots: [s, s], rounds: plainRounds() })); };
  for (const cmd of ['test -f test/a.test.mjs', 'cat test/a.test.mjs', 'grep -q T1 test/a.test.mjs', 'true test/a.test.mjs']) refused(rg(cmd), 'red_green_required', cmd);
  for (const cmd of ['node --test test/a.test.mjs', 'node --test {test}']) signable(rg(cmd), cmd);
});

test('T1-c55: a citation of QL-0.02:2.1 is refused when that record\'s round 2 is unsigned, signed by a key outside reviewerKeys, or has answer 1 edited after signing; SIGNABLE when its signature verifies and the chain to it is intact; a receiving record counts only once it verifies', () => {
  const NEWR = 'src/a.mjs exports a and nothing else';
  const rounds2 = [{ round: 1, verdict: 'findings', answers: [answerOf(1, 'a gap', { task: 'T1', statement: 'x', verifier: { type: 'scope' } })] }, { round: 2, verdict: 'findings', answers: [answerOf(1, 'the requirement says too little', { task: 'T1', ...clone(specV2().tasks[0].criteria[1]) })] }];
  const make = (tamper) => {
    const v2 = specV2(); v2.tasks[0].requirements[0] = NEWR;
    const rounds = baseRounds(); rounds[1].amendments = [{ task: 'T1', field: 'requirement', from: 'src/a.mjs exports a', to: NEWR, answer: 'QL-0.02:2.1' }];
    return ev(sc({ snapshots: [specV1(), v2], disk: v2, rounds, extra: receiving({ rounds: rounds2, tamper }) }));
  };
  signable(make(), 'QL-0.02 round 2 signed by a reviewer key, the chain to it intact');
  const foreign = generateKeyPair().privateKey;
  for (const [what, tamper] of [
    ['round 2 unsigned', (r) => { delete r.rounds[1].sig; }],
    ['round 2 signed by a key outside reviewerKeys', (r) => { r.rounds[1].sig = sign(roundBody(r.rounds, 1, null), foreign); }],
    ['answer 1 of round 2 edited after signing', (r) => { r.rounds[1].answers[0].how += ' (edited)'; }],
    ['round 1 edited after round 2 was signed', (r) => { r.rounds[0].answers[0].how += ' (edited)'; }],
  ]) {
    const r = make(tamper);
    weakened(r, 'T1', null, what);
    assert.match(reason(r, 'never_weakens'), /its answer QL-0\.02:2\.1: in QL-0\.02's record, round \d/, what);
  }
  // a receiving spec's replacements count only as far as its record verifies
  const moved = { statement: 'b refuses a cycle', verifier: { type: 'test_red_green', test_file: 'test/b.test.mjs', cmd: 'node --test test/b.test.mjs' } };
  const renamed = { ...clone(moved), statement: 'b refuses an import cycle' };
  const folded = (tamper) => {
    const rounds = baseRounds();
    rounds[0].answers.push(answerOf(3, 'b has no cycle check', { task: 'T2', ...clone(moved) }, { folded_as: { spec: 'QL-0.02', task: 'T1', ...clone(moved) } }));
    rounds[1].amendments = [{ kind: 'move', task: 'T2', to_spec: 'QL-0.02', to_task: 'T1', answer: '1.3' }];
    const extra = receiving({ recv: (t) => { t.criteria.splice(1, 0, clone(renamed)); }, rounds: [{ round: 1, verdict: 'findings', answers: [], amendments: [{ task: 'T1', field: 'statement', from: moved.statement, to: renamed.statement, answer: '1.1' }] }], tamper });
    return ev(sc({ rounds, extra }));
  };
  signable(folded(), 'the receiving record signed and closed');
  refused(folded((r) => { delete r.rounds[0].sig; }), 'added_verbatim', 'the receiving record unsigned');
  refused(folded((r) => { delete r.rounds[0].closing; }), 'added_verbatim', 'the receiving round\'s amendments with no closing envelope');
  refused(folded((r) => { r.rounds[0].amendments[0].to = 'b refuses an import cycle'; r.rounds[0].amendments.push({ task: 'T1', field: 'statement', from: 'x', to: 'y' }); }), 'added_verbatim', 'the receiving round\'s amendments edited after closing');
});
