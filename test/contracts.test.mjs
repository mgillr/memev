import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { newVault, cleanup, tmpdir, OWNER, PKG } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
import { handle } from '../src/server/mcp.mjs';
import { draftTasks } from '../src/engine/redteam-gate.mjs';
import { scenario, fresh, git as fixtureGit, commitAll, specHash, KEYS, HERE } from './fixtures/redteam/lib.mjs';
after(cleanup);

function setup() {
  const { root, v } = newVault();
  const work = path.join(root, '..', 'work'); fs.mkdirSync(work, { recursive: true });
  const d = v.contractDraft(OWNER, { title: 'Add a health endpoint', project: 'api', workdir: work, tasks: [{ id: 'T1', title: 'health endpoint', scope: ['**'], criteria: [
    { statement: 'the handler exists', verifier: { type: 'file_exists', path: 'health.js' } },
    { statement: 'it answers ok', verifier: { type: 'grep', file: 'health.js', pattern: 'ok: true' } },
    { statement: 'the check script passes', verifier: { type: 'command', cmd: 'test -f health.js' } },
  ] }] });
  return { root, v, work, d };
}

test('self-sign, open until verified, then closed; the signature covers the exact bytes', () => {
  const { root, v, work, d } = setup();
  const s = v.contractSign(OWNER, { id: d.id, session: 'sess-k' });
  assert.equal(s.signed, true);
  assert.ok(fs.existsSync(path.join(root, 'contracts', 'keys', `${s.keyid}.pub`)));
  assert.equal(v.contractCheckSignature(d.id).ok, true);
  assert.deepEqual(v.contractGate('sess-k').map((c) => c.id), [d.id]);
  assert.deepEqual(v.contractGate('another-session'), []);
  const r1 = v.contractVerify(OWNER, { id: d.id });
  assert.equal(r1.ok, false);
  fs.writeFileSync(path.join(work, 'health.js'), 'export default () => ({ ok: true });\n');
  const r2 = v.contractVerify(OWNER, { id: d.id });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal(v.contractList().find((c) => c.id === d.id).state, 'done');
  assert.deepEqual(v.contractGate('sess-k'), []);
  v.close();
});

test('signed contracts are immutable: refused by the vault, rejected by git, and an edit breaks verification', () => {
  const { root, v, d } = setup();
  v.contractSign(OWNER, { id: d.id });
  v.commits.flush();
  const p = `contracts/signed/${d.id}.json`;
  assert.throws(() => v.write(OWNER, { path: p, body: '{}' }), /immutable/);
  assert.throws(() => v.contractSign(OWNER, { id: d.id }), /already signed/);
  const file = path.join(root, p);
  const c = JSON.parse(fs.readFileSync(file, 'utf8')); c.tasks[0].criteria.pop(); fs.writeFileSync(file, JSON.stringify(c, null, 2));
  assert.match(v.contractCheckSignature(d.id).detail, /changed after signing/);
  assert.equal(v.contractVerify(OWNER, { id: d.id }).ok, false);
  execFileSync('git', ['add', p], { cwd: root });
  assert.throws(() => execFileSync('git', ['commit', '-q', '-m', 'weaken', '--', p], { cwd: root, stdio: 'pipe' }), /refusing to change signed contract files/);
  execFileSync('git', ['checkout', 'HEAD', '--', p], { cwd: root });
  assert.equal(v.contractCheckSignature(d.id).ok, true);
  const a = v.contractAmend(OWNER, { id: d.id, title: 'Add a health endpoint, smaller' });
  assert.notEqual(a.id, d.id);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, a.path), 'utf8')).supersedes, d.id);
  v.close();
});

test('commands in criteria never run for remote callers', () => {
  const { v, d } = setup();
  v.contractSign(OWNER, { id: d.id });
  const r = v.contractVerify(OWNER, { id: d.id }, { local: false });
  assert.equal(r.tasks[0].criteria[2].status, 'BLOCKED');
  v.close();
});

test('decompose turns a scope into a reviewable proposal', () => {
  const { v } = newVault();
  const out = v.contractDecompose(OWNER, { scope: { schema: 'attest-scope/1', prefix: 'API', defaults: { scope: ['src/**'] }, tasks: [{ n: 1, title: 'add route', acceptance: [{ statement: 'tests pass', cmd: 'npm test' }, 'scope'] }, { n: 2, title: 'document it', depends_on: [1], acceptance: [{ statement: 'documented', verifier: { type: 'grep', file: 'src/README.md', pattern: 'health' } }, 'scope'] }] } });
  assert.deepEqual(out.ids, ['API-01', 'API-02']);
  assert.match(out.path, /^contracts\/proposals\//);
  v.close();
});

test('the vendored code keeps its licence and notice, and the licence is compatible', () => {
  const lic = fs.readFileSync(path.join(PKG, 'vendor', 'attest', 'LICENSE'), 'utf8');
  assert.match(lic, /Apache License\s+Version 2\.0/);
  assert.match(fs.readFileSync(path.join(PKG, 'LICENSE'), 'utf8'), /Apache License\s+Version 2\.0/, 'Memev is Apache-2.0 too');
  assert.ok(fs.existsSync(path.join(PKG, 'vendor', 'attest', 'NOTICE')));
  assert.match(fs.readFileSync(path.join(PKG, 'NOTICE'), 'utf8'), /vendor\//);
  for (const f of fs.readdirSync(path.join(PKG, 'vendor', 'attest')).filter((x) => x.endsWith('.mjs'))) assert.match(fs.readFileSync(path.join(PKG, 'vendor', 'attest', f), 'utf8'), /Modified for Memev/, f);
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'));
  assert.ok(pkg.files.includes('vendor/'));
});

// ---- QL-1.01 T2: the red-team gate in the engine's draft and sign paths (and so in memev contract new and sign) ----

const BASE_FIXTURE = path.join(HERE, 'base');
const OK_FIXTURE = path.join(HERE, 'cases', 'ok');
const QA_SPEC = 'contracts/qa/specs/QA-1.json';
const qaSpec = () => ({ title: 'QA one', project: 'memev', workdir: null, request: 'qa', tasks: [{ id: 'T1', title: 'Make a', phase: 'implement', depends_on: [], requirements: ['a exists'], description: '', scope: ['src/a.mjs'], criteria: [{ statement: 'a exists', verifier: { type: 'file_exists', path: 'src/a.mjs' } }, { statement: 'a is a file', verifier: { type: 'command', cmd: 'test -f src/a.mjs' } }], stop_rules: ['STOP and report.'] }] });
/** A repository with the QA-1 spec and its record; signable: clean last round, else the last round has findings. */
const qaRepo = ({ signable, priv } = {}) => {
  const spec = qaSpec();
  const rounds = [{ verdict: 'findings', answers: [] }, { verdict: signable ? 'clean' : 'findings', answers: [] }];
  const r = scenario({ id: 'QA-1', area: 'qa', snapshots: [spec, spec], rounds, manifest: { kind: 'docs' }, ...(priv ? { priv } : {}) });
  made.push(r.dir);
  return { ...r, spec };
};
const made = [];
after(() => { for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const freshFixture = (f) => { const d = fresh(f); made.push(d); return d; };
const draftFiles = (root) => { try { return fs.readdirSync(path.join(root, 'contracts', 'drafts')).filter((n) => n.endsWith('.json')); } catch { return []; } };
const signedFiles = (root) => { try { return fs.readdirSync(path.join(root, 'contracts', 'signed')).filter((n) => n.endsWith('.json') && !n.endsWith('.sig.json')); } catch { return []; } };
const tool = async (v, name, args, local) => { const r = (await handle(v, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { identity: OWNER, client: 't', local })).result; return { isError: !!r.isError, text: r.content?.[0]?.text || '', data: r.structuredContent }; };
/** A draft body as a plain vault (no records anywhere) writes it, to be put into another vault through memev_write. */
const plainDraft = ({ workdir = null, ...args }) => { const { v } = newVault({ git: false }); const d = v.contractDraft(OWNER, args); const body = JSON.parse(fs.readFileSync(path.join(v.root, d.path), 'utf8')); v.close(); return { id: d.id, body: { ...body, workdir } }; };
const writeDraft = (v, id, body) => v.write(OWNER, { path: `contracts/drafts/${id}.json`, body: `${JSON.stringify(body, null, 2)}\n` });
const gatedVault = (repo, opts = {}) => { const { root, v } = newVault({ git: false, reviewerKeys: KEYS, ...opts }); v.config.contracts = { ...v.config.contracts, redteam_required: true, redteam_root: repo.dir }; return { root, v }; };
const REFUSED = /red-team gate/;
const noSigned = (root, msg) => assert.deepEqual(signedFiles(root), [], msg);
const cliJson = (r) => { const m = /"id": "([^"]+)"/.exec(r.out); return m ? m[1] : null; };
function cliVault(extra = {}) {
  const sb = sandbox();
  const r = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
  assert.equal(r.code, 0, r.err + r.out);
  const cfgFile = path.join(sb.root, '.memev', 'config.json');
  if (extra.contracts) { const c = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); c.contracts = { ...c.contracts, ...extra.contracts }; fs.writeFileSync(cfgFile, JSON.stringify(c, null, 2)); sb.run(['stop']); }
  return sb;
}

test('T2-c05: memev contract new runs the gate first: a NOT SIGNABLE or NO RECORD spec leaves no draft, a SIGNABLE one is drafted with provenance.spec_sha256 and signs; sign refuses a draft whose tasks differ from the spec\'s', () => {
  const sb = cliVault();
  try {
    // the command line, through the daemon (which holds the real reviewer keys): the committed fixtures
    const notSignable = freshFixture(OK_FIXTURE);
    const specPath = path.join(notSignable, 'contracts/quality-loop/specs/QL-0.01.json');
    const refused = sb.run(['contract', 'new', specPath]);
    assert.notEqual(refused.code, 0, refused.out + refused.err);
    assert.match(refused.out + refused.err, /red-team gate.*NOT SIGNABLE/);
    assert.deepEqual(draftFiles(sb.root), []);
    const noRecord = freshFixture(OK_FIXTURE);
    fs.rmSync(path.join(noRecord, 'contracts/quality-loop/redteam/QL-0.01.json'));
    commitAll(noRecord, 'no record');
    const none = sb.run(['contract', 'new', path.join(noRecord, 'contracts/quality-loop/specs/QL-0.01.json')]);
    assert.notEqual(none.code, 0, none.out + none.err);
    assert.match(none.out + none.err, /red-team gate.*NO RECORD/);
    assert.deepEqual(draftFiles(sb.root), []);
    const good = freshFixture(BASE_FIXTURE);
    const goodSpec = path.join(good, 'contracts/quality-loop/specs/QL-0.01.json');
    const made1 = sb.run(['contract', 'new', goodSpec]);
    assert.equal(made1.code, 0, made1.out + made1.err);
    const id = cliJson(made1);
    assert.ok(id, made1.out);
    const draft = JSON.parse(fs.readFileSync(path.join(sb.root, 'contracts', 'drafts', `${id}.json`), 'utf8'));
    assert.equal(draft.provenance.spec_sha256, specHash(JSON.parse(fs.readFileSync(goodSpec, 'utf8'))));
    const signed = sb.run(['contract', 'sign', id]);
    assert.equal(signed.code, 0, signed.out + signed.err);
    assert.deepEqual(signedFiles(sb.root), [`${id}.json`]);
  } finally { sb.stop(); }
  // sign refuses a draft that carries a provenance hash and tasks that are not the tasks drafted from that spec
  const repo = qaRepo({ signable: true });
  const { root, v } = gatedVault(repo);
  const ok = v.contractDraft(OWNER, { title: repo.spec.title, workdir: repo.dir, tasks: repo.spec.tasks, spec: repo.abs(QA_SPEC) });
  const body = JSON.parse(fs.readFileSync(path.join(root, ok.path), 'utf8'));
  assert.equal(body.provenance.spec_sha256, specHash(repo.spec));
  const edited = JSON.parse(JSON.stringify(body)); edited.tasks[0].criteria[1].verifier.cmd = 'test -f src/b.mjs';
  const bad = plainDraft({ title: edited.title, workdir: repo.dir, tasks: edited.tasks, provenance: body.provenance });
  writeDraft(v, bad.id, bad.body);
  assert.throws(() => v.contractSign(OWNER, { id: bad.id }), /not the tasks drafted from the spec/);
  noSigned(root, 'nothing signed');
  assert.equal(v.contractSign(OWNER, { id: ok.id }).signed, true, 'the draft that is the spec\'s own tasks signs');
  v.close();
});

test('T2-c06: with records required, no route to a signed contract passes a spec whose record is NOT SIGNABLE: draft and sign (local or not), from a request, amend, and a spec copied outside the repository', async () => {
  const repo = qaRepo({ signable: false });
  fs.mkdirSync(path.join(repo.dir, 'scripts', 'gate'), { recursive: true });
  fs.writeFileSync(path.join(repo.dir, 'scripts', 'gate', 'redteam-gate.mjs'), '// the repository\'s own gate script plays no part\n');
  const { root, v } = gatedVault(repo);
  const tasks = draftTasks(repo.spec);
  // (a) the draft tool, and then sign of a draft written through memev_write, with the caller local and not
  const dr = await tool(v, 'memev_contract_draft', { title: repo.spec.title, tasks: repo.spec.tasks, workdir: repo.dir }, true);
  assert.equal(dr.isError, true, dr.text);
  assert.match(dr.text, REFUSED);
  assert.match(dr.text, /last_clean/);
  assert.deepEqual(draftFiles(root), []);
  const written = plainDraft({ title: repo.spec.title, workdir: repo.dir, tasks: repo.spec.tasks });
  writeDraft(v, written.id, written.body);
  for (const local of [true, false]) {
    const sg = await tool(v, 'memev_contract_sign', { id: written.id }, local);
    assert.equal(sg.isError, true, `local ${local}: ${sg.text}`);
    assert.match(sg.text, REFUSED);
  }
  assert.throws(() => v.contractSign(OWNER, { id: written.id }), REFUSED);
  noSigned(root, '(a)');
  // (b) from a request, then sign
  assert.throws(() => v.contractFromRequest(OWNER, { request: 'make a', title: repo.spec.title, workdir: repo.dir, tasks }), REFUSED);
  const req = plainDraft({ title: repo.spec.title, workdir: repo.dir, tasks });
  writeDraft(v, req.id, req.body);
  assert.throws(() => v.contractSign(OWNER, { id: req.id }), REFUSED);
  noSigned(root, '(b)');
  // (c) amend of a signed contract: signed while the record was clean, then the record stopped being SIGNABLE
  const good = qaRepo({ signable: true });
  const g = gatedVault(good);
  const d = g.v.contractDraft(OWNER, { title: good.spec.title, workdir: good.dir, tasks: good.spec.tasks, spec: good.abs(QA_SPEC) });
  g.v.contractSign(OWNER, { id: d.id });
  good.mutate((r) => { r.rounds[1].verdict = 'findings'; });
  good.commit('the record is no longer clean');
  const changed = JSON.parse(JSON.stringify(draftTasks(good.spec))); changed[0].criteria[1].verifier.cmd = 'test -f src/b.mjs';
  assert.throws(() => g.v.contractAmend(OWNER, { id: d.id, tasks: changed }), REFUSED);
  assert.throws(() => g.v.contractAmend(OWNER, { id: d.id, title: 'QA one, again' }), REFUSED);
  const am = plainDraft({ title: good.spec.title, workdir: good.dir, tasks: changed, provenance: JSON.parse(fs.readFileSync(path.join(g.root, d.path), 'utf8')).provenance });
  writeDraft(g.v, am.id, am.body);
  assert.throws(() => g.v.contractSign(OWNER, { id: am.id }), REFUSED);
  assert.deepEqual(signedFiles(g.root), [`${d.id}.json`], '(c) only the contract signed while the record was clean');
  // (d) a copy of the spec outside the repository, cwd outside it, through the command line
  const sb = cliVault({ contracts: { redteam_required: true, redteam_root: repo.dir } });
  try {
    const outside = tmpdir('outside-'); const copy = path.join(outside, 'QA-1.json');
    fs.writeFileSync(copy, fs.readFileSync(repo.abs(QA_SPEC)));
    const r = sb.run(['contract', 'new', copy]);
    assert.notEqual(r.code, 0, r.out + r.err);
    assert.match(r.out + r.err, REFUSED);
    assert.deepEqual(draftFiles(sb.root), []);
    const sg = sb.run(['contract', 'sign', 'k-nothing-000000']);
    assert.notEqual(sg.code, 0);
    assert.deepEqual(signedFiles(sb.root), []);
  } finally { sb.stop(); }
  v.close(); g.v.close();
});

test('T2-c07: sign checks the record again: a draft of a NOT SIGNABLE spec, an in-scope commit after the draft, a draft rewritten through memev_write, all refused; the provenance hash is the one the gate judged', async () => {
  // (a) provenance names a NOT SIGNABLE spec and the tasks are exactly its drafted tasks
  const bad = qaRepo({ signable: false });
  const a = gatedVault(bad);
  const forged = plainDraft({ title: 'Something else', workdir: bad.dir, tasks: draftTasks(bad.spec), provenance: { spec_sha256: specHash(bad.spec) } });
  writeDraft(a.v, forged.id, forged.body);
  assert.throws(() => a.v.contractSign(OWNER, { id: forged.id }), REFUSED);
  for (const local of [true, false]) { const r = await tool(a.v, 'memev_contract_sign', { id: forged.id }, local); assert.equal(r.isError, true, r.text); assert.match(r.text, REFUSED); }
  noSigned(a.root, '(a)');
  // (b) drafted while SIGNABLE, then a commit changes an in-scope src file
  const good = qaRepo({ signable: true });
  const b = gatedVault(good);
  const d = b.v.contractDraft(OWNER, { title: good.spec.title, workdir: good.dir, tasks: good.spec.tasks, spec: good.abs(QA_SPEC) });
  fs.writeFileSync(good.abs('src/a.mjs'), 'export const a = 2;\n'); good.commit('change an in-scope file');
  assert.throws(() => b.v.contractSign(OWNER, { id: d.id }), /head_stale_src/);
  noSigned(b.root, '(b)');
  // (c) a draft made while SIGNABLE, rewritten through memev_write: the workdir changed, and the provenance removed
  const ok = qaRepo({ signable: true });
  const c = gatedVault(ok);
  const d2 = c.v.contractDraft(OWNER, { title: ok.spec.title, workdir: ok.dir, tasks: ok.spec.tasks, spec: ok.abs(QA_SPEC) });
  const body = JSON.parse(fs.readFileSync(path.join(c.root, d2.path), 'utf8'));
  // (d) the provenance hash is the canonical hash of the spec bytes the gate judged
  assert.equal(body.provenance.spec_sha256, specHash(JSON.parse(fs.readFileSync(ok.abs(QA_SPEC), 'utf8'))));
  const moved = { ...body, workdir: path.join(c.root, '..') };
  writeDraft(c.v, d2.id, moved);
  assert.throws(() => c.v.contractSign(OWNER, { id: d2.id }), REFUSED);
  const { provenance, ...stripped } = body;
  writeDraft(c.v, d2.id, stripped);
  assert.throws(() => c.v.contractSign(OWNER, { id: d2.id }), REFUSED);
  const r = await tool(c.v, 'memev_contract_sign', { id: d2.id }, true);
  assert.equal(r.isError, true, r.text);
  noSigned(c.root, '(c)');
  writeDraft(c.v, d2.id, body);
  assert.equal(c.v.contractSign(OWNER, { id: d2.id }).signed, true, 'the draft as it was checked still signs');
  a.v.close(); b.v.close(); c.v.close();
});

test('T2-c11: with contracts.redteam_required off, a repository that holds records still requires them: the gate script absent, replaced, the record folder removed from the working tree or in a later commit', async () => {
  const sb = cliVault();
  try {
    const variants = {
      'script absent': () => {},
      'script replaced': (r) => { fs.mkdirSync(r.abs('scripts/gate'), { recursive: true }); fs.writeFileSync(r.abs('scripts/gate/redteam-gate.mjs'), `console.log('${QA_SPEC}: SIGNABLE');\n`); },
      'folder removed from the working tree only': (r) => { fs.rmSync(r.abs('contracts/qa/redteam'), { recursive: true, force: true }); },
      'folder removed in a later commit': (r) => { fs.rmSync(r.abs('contracts/qa/redteam'), { recursive: true, force: true }); r.commit('remove the records'); },
    };
    for (const [name, change] of Object.entries(variants)) {
      const repo = qaRepo({ signable: false });
      change(repo);
      const r = sb.run(['contract', 'new', repo.abs(QA_SPEC)]);
      assert.notEqual(r.code, 0, `${name}: ${r.out}${r.err}`);
      assert.match(r.out + r.err, REFUSED, name);
      assert.deepEqual(draftFiles(sb.root), [], `${name}: no draft`);
      // a draft written through memev_write that carries the spec's title and drafted tasks (and the repository as its workdir)
      const { root, v } = newVault({ git: false, reviewerKeys: KEYS });
      assert.equal(v.config.contracts.redteam_required, undefined, 'the setting is off');
      const w = plainDraft({ title: repo.spec.title, workdir: repo.dir, tasks: draftTasks(repo.spec) });
      writeDraft(v, w.id, w.body);
      for (const local of [true, false]) {
        const s = await tool(v, 'memev_contract_sign', { id: w.id }, local);
        assert.equal(s.isError, true, `${name}, local ${local}: ${s.text}`);
        assert.match(s.text, REFUSED, name);
      }
      assert.throws(() => v.contractSign(OWNER, { id: w.id }), REFUSED, name);
      noSigned(root, name);
      v.close();
    }
  } finally { sb.stop(); }
  // and a repository that never held records is not touched by the rule
  const { root, v } = newVault({ git: false });
  const work = path.join(root, '..', 'plain'); fs.mkdirSync(work, { recursive: true }); fixtureGit(work, ['init', '-q']);
  const d = v.contractDraft(OWNER, { title: 'No records here', workdir: work, tasks: qaSpec().tasks });
  assert.equal(v.contractSign(OWNER, { id: d.id }).signed, true);
  v.close();
});

test('T2-c13: a record signed only by a test reviewer key is refused with review_sig in every environment and config a daemon or vault could read, and signs only through the Vault constructor option', () => {
  const kp = (() => { const g = crypto.generateKeyPairSync('ed25519'); return { publicKey: g.publicKey.export({ type: 'spki', format: 'pem' }), privateKey: g.privateKey.export({ type: 'pkcs8', format: 'pem' }) }; })();
  const repo = qaRepo({ signable: true, priv: kp.privateKey });
  const names = ['MEMEV_REVIEWER_KEYS', 'MEMEV_REVIEWER_KEY', 'MEMEV_REDTEAM_KEYS', 'MEMEV_REDTEAM_REVIEWER_KEYS', 'REVIEWER_KEYS', 'REDTEAM_REVIEWER_PUB', 'MEMEV_CONTRACTS_REVIEWER_KEYS'];
  const env = Object.fromEntries(names.map((n) => [n, kp.publicKey]));
  const keysConfig = Object.fromEntries(['reviewer_keys', 'reviewerKeys', 'redteam_reviewer_keys', 'redteam_keys', 'review_keys', 'stop_keys'].map((k) => [k, [kp.publicKey]]));
  // the command line: a daemon started with the key in every such variable and in the vault config
  const sb = cliVault({ contracts: keysConfig });
  try {
    sb.run(['stop']);
    const r = sb.run(['contract', 'new', repo.abs(QA_SPEC)], { extraEnv: env });
    assert.notEqual(r.code, 0, r.out + r.err);
    assert.match(r.out + r.err, /review_sig/);
    assert.deepEqual(draftFiles(sb.root), []);
  } finally { sb.stop(); }
  // a Vault opened the same way: environment, config, no constructor option
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  Object.assign(process.env, env);
  try {
    const { root, v } = newVault({ git: false });
    v.config.contracts = { ...v.config.contracts, ...keysConfig, redteam_required: true, redteam_root: repo.dir };
    const w = plainDraft({ title: repo.spec.title, workdir: repo.dir, tasks: draftTasks(repo.spec), provenance: { spec_sha256: specHash(repo.spec) } });
    writeDraft(v, w.id, w.body);
    assert.throws(() => v.contractSign(OWNER, { id: w.id }), /review_sig/);
    assert.throws(() => v.contractDraft(OWNER, { title: repo.spec.title, workdir: repo.dir, tasks: repo.spec.tasks, spec: repo.abs(QA_SPEC) }), /review_sig/);
    noSigned(root, 'no constructor option');
    v.close();
    // only the constructor option signs
    const k = newVault({ git: false, reviewerKeys: [kp.publicKey] });
    k.v.config.contracts = { ...k.v.config.contracts, redteam_required: true, redteam_root: repo.dir };
    const d = k.v.contractDraft(OWNER, { title: repo.spec.title, workdir: repo.dir, tasks: repo.spec.tasks, spec: repo.abs(QA_SPEC) });
    assert.equal(k.v.contractSign(OWNER, { id: d.id }).signed, true);
    k.v.close();
  } finally { for (const n of names) { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; } }
});
