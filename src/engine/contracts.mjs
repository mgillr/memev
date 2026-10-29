// SPDX-License-Identifier: Apache-2.0
// Signed task contracts in the vault. A session drafts a contract (tasks with acceptance criteria),
// signs it with this machine's key (self-signing: the agent binds itself to the work), and cannot
// call the work done until `verify` re-runs the criteria. Signed files are immutable three ways: the
// vault refuses writes to contracts/signed/ and contracts/keys/, a pre-commit hook in the vault's git
// repository rejects changes to them, and any edit on disk breaks the signature. Changing a signed
// contract means amending: a new contract that supersedes the old one.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { configDir, randomToken, slug, now, readJson, writePrivate, exists, truncate, run as spawn } from './util.mjs';
import { git } from './git.mjs';
import * as A from '../../vendor/attest/contract.mjs';
import { decompose as attestDecompose } from '../../vendor/attest/decompose.mjs';
import { sign as dsseSign, verify as dsseVerify, keyId, generateKeyPair, canonicalHash } from '../../vendor/attest/signature.mjs';

const STOP_AMEND = 'If the requirements change: do not edit this contract. Amend it (memev_contract_amend), which signs a new version that supersedes this one.';

/** Requirements from free text: bullet or numbered lines, else the parts of "build X with A, B and C". */
export function inferRequirements(text) {
  const t = String(text || '').trim();
  const bullets = t.split('\n').map((l) => /^\s*(?:[-*\u2022]|\d+[.)])\s+(.+)$/.exec(l)?.[1]?.trim()).filter(Boolean);
  if (bullets.length) return bullets.slice(0, 20);
  const body = t.replace(/^(i have a project[,:.]?\s*)/i, '');
  const m = /\b(?:with|that|which|so that|including)\b\s+([\s\S]+)$/i.exec(body);
  const head = (m ? body.slice(0, m.index) : body).replace(/[.,;:\s]+$/, '').trim();
  const parts = m ? m[1].split(/;|,|\.\s+|\band also\b|\band\b/i).map((x) => x.trim().replace(/^(it |and |also )+/i, '').replace(/[.\s]+$/, '')).filter((x) => x.length > 2) : [];
  return [head, ...parts].filter(Boolean).slice(0, 20);
}
const FILE_RE = /(?:^|[\s`'"(])((?:[\w-]+\/)*[\w-]+\.(?:mjs|cjs|js|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|c|h|cpp|cs|php|sh|md|json|ya?ml|toml|html|css|sql))(?=$|[\s`'"),.;:])/g;
export const mentionedFiles = (s) => [...new Set([...String(s || '').matchAll(FILE_RE)].map((x) => x[1]))];
/** Check shorthands → attest verifiers. Never a CI service: everything runs on this machine. */
export function toVerifier(ch) {
  if (!ch || typeof ch !== 'object') return null;
  if (ch.type && A.VERIFIERS.includes(ch.type)) return ch;
  if (ch.verifier) return toVerifier(ch.verifier);
  if (ch.cmd) return { type: 'command', cmd: String(ch.cmd), ...(ch.expect_exit !== undefined ? { expect_exit: ch.expect_exit } : {}) };
  if (ch.file && ch.pattern) return { type: 'grep', file: ch.file, pattern: ch.pattern };
  if (ch.grep?.file && ch.grep?.pattern) return { type: 'grep', file: ch.grep.file, pattern: ch.grep.pattern };
  if (ch.file || ch.path) return { type: 'file_exists', path: ch.file || ch.path };
  if (ch.test_file) return { type: 'test_exists', test_file: ch.test_file };
  return null;
}
/** The project's own test command, if it has an obvious one. */
export function projectTestCommand(wd) {
  if (!wd) return null;
  const has = (f) => exists(path.join(wd, f));
  if (has('package.json')) { const pj = readJson(path.join(wd, 'package.json'), {}); if (pj.scripts?.test && !/no test specified/.test(pj.scripts.test)) return 'npm test'; }
  if (has('pyproject.toml') || has('pytest.ini') || has('setup.py')) return 'python3 -m pytest -q';
  if (has('Cargo.toml')) return 'cargo test';
  if (has('go.mod')) return 'go test ./...';
  if (has('Makefile') && /^test:/m.test(fs.readFileSync(path.join(wd, 'Makefile'), 'utf8'))) return 'make test';
  return null;
}

export class ContractError extends Error { constructor(code, m) { super(m); this.code = code; } }
const SIGNED = 'contracts/signed', KEYS = 'contracts/keys';

export const PRE_COMMIT = `#!/bin/sh
# Memev: signed contracts and their keys are immutable once committed.
bad=$(git diff --cached --name-only --diff-filter=MDR -- '${SIGNED}/' '${KEYS}/')
if [ -n "$bad" ]; then
  echo "memev: refusing to change signed contract files (amend with a new contract instead):" >&2
  echo "$bad" >&2
  exit 1
fi
`;
export function installVaultHooks(root) {
  const dir = path.join(root, '.git', 'hooks'); if (!exists(path.join(root, '.git'))) return false;
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'pre-commit');
  if (!exists(f) || fs.readFileSync(f, 'utf8') !== PRE_COMMIT) fs.writeFileSync(f, PRE_COMMIT, { mode: 0o755 });
  git(root, ['config', 'core.hooksPath', '.git/hooks']);
  return true;
}

function signingKey(dir) {
  const f = path.join(dir, 'contract-ed25519.pem');
  if (!exists(f)) { const kp = generateKeyPair(); writePrivate(f, kp.privateKey); }
  const priv = fs.readFileSync(f, 'utf8');
  const pub = crypto.createPublicKey(priv).export({ type: 'spki', format: 'pem' });
  return { priv, pub, id: keyId(pub) };
}

export function attach(Vault) {
  const P = Vault.prototype;

  P.contractDraft = function (identity, { title, project = null, workdir = null, tasks = [], supersedes = null, client = null, request = null, provenance = null, version = null }) {
    if (!title) throw new ContractError('bad_request', 'a contract needs a title');
    if (!Array.isArray(tasks) || !tasks.length) throw new ContractError('bad_request', 'a contract needs at least one task');
    const id = `k-${slug(title, 24)}-${randomToken(3)}`;
    const c = { ...A.skeleton(project || 'memev'), id, title, workdir, created: now(), version: version || 1, ...(supersedes ? { supersedes } : {}), ...(request ? { request: truncate(String(request), 4000) } : {}), ...(provenance ? { provenance } : {}), tasks: tasks.map((t, i) => A.makeTask({ id: t.id || `T${i + 1}`, title: t.title, phase: t.phase || 'implement', depends_on: t.depends_on || [], requirements: t.requirements || [], description: t.description || '', scope: t.scope || ['**'], criteria: t.criteria || [], stop_rules: t.stop_rules || [] })) };
    const errs = A.validate(c);
    if (errs.length) throw new ContractError('invalid', `the contract is not valid: ${errs.slice(0, 5).join('; ')}`);
    this.write(identity, { path: `contracts/drafts/${id}.json`, body: `${JSON.stringify(c, null, 2)}\n`, client });
    return { id, path: `contracts/drafts/${id}.json`, tasks: c.tasks.length };
  };

  P.contractSign = function (identity, { id, client = null, session = null }) {
    this._need(identity, 'write', `${SIGNED}/${id}.json`);
    const draft = this._read(`contracts/drafts/${id}.json`);
    if (!draft) throw new ContractError('not_found', `no draft contract ${id}`);
    if (this._read(`${SIGNED}/${id}.json`) !== null) throw new ContractError('immutable', `${id} is already signed; amend it instead`);
    const c = JSON.parse(draft);
    const errs = A.validate(c); if (errs.length) throw new ContractError('invalid', errs.join('; '));
    const key = signingKey(this.opts.keyDir || path.join(configDir(), 'keys'));
    const env_ = dsseSign(c, key.priv);
    const body = `${JSON.stringify(c, null, 2)}\n`;
    if (this._read(`${KEYS}/${key.id}.pub`) === null) this.write(identity, { path: `${KEYS}/${key.id}.pub`, body: key.pub, client, internal: true });
    this.write(identity, { path: `${SIGNED}/${id}.json`, body, client, internal: true });
    this.write(identity, { path: `${SIGNED}/${id}.sig.json`, body: `${JSON.stringify(env_, null, 2)}\n`, client, internal: true });
    this._applyMisc(this.log.append({ type: 'contract.signed', path: null, agent: identity.agent, client, data: { id, hash: canonicalHash(c), keyid: key.id, session, supersedes: c.supersedes || null } }));
    // the signed contract is a memory: a decision anyone can recall, linked to its project, the
    // session that signed it, the decisions it rests on and the version it replaces (provenance)
    const project = c.project && c.project !== 'memev' ? c.project : null;
    const mem = this.remember(identity, { kind: 'decision', project, client, text: `Signed contract ${id} (v${c.version || 1}) "${c.title}"${c.supersedes ? `, superseding ${c.supersedes}` : ''}: ${c.tasks.map((t) => `${t.id} ${t.title}`).join('; ')}. Status: memev_contract_status ${id}.`, why: c.request ? truncate(c.request.replace(/\s+/g, ' '), 300) : null });
    const node = `contract ${id}`;
    if (project) this.link(identity, { from: node, to: project, type: 'part_of', why: 'contract for this project', client });
    if (session || c.provenance?.session) this.link(identity, { from: node, to: `session ${String(session || c.provenance.session).slice(0, 16)}`, type: 'derived_from', why: 'signed in this conversation', client });
    for (const d of c.provenance?.decisions || []) this.link(identity, { from: node, to: String(d), type: 'derived_from', why: 'a decision the contract rests on', client });
    if (c.supersedes) this.link(identity, { from: node, to: `contract ${c.supersedes}`, type: 'supersedes', why: 'new version', client });
    return { id, signed: true, version: c.version || 1, supersedes: c.supersedes || null, hash: canonicalHash(c), keyid: key.id, path: `${SIGNED}/${id}.json`, memory: mem.path || null, next: 'build the tasks in order; run memev_contract_verify after each one' };
  };

  P.contractCheckSignature = function (id) {
    const body = this._read(`${SIGNED}/${id}.json`); const sig = this._read(`${SIGNED}/${id}.sig.json`);
    if (!body || !sig) return { ok: false, detail: `${id} is not signed` };
    let c, env; try { c = JSON.parse(body); env = JSON.parse(sig); } catch { return { ok: false, detail: 'unreadable contract or signature' }; }
    const pub = this._read(`${KEYS}/${env.signatures?.[0]?.keyid}.pub`);
    if (!pub) return { ok: false, detail: 'the signing key is not in contracts/keys' };
    return { ...dsseVerify(c, env, pub), contract: c };
  };

  /** Re-run every criterion. Commands run only on this machine and only in the contract's workdir. */
  P.contractVerify = function (identity, { id, client = null }, { local = true } = {}) {
    this._need(identity, 'read', null);
    const s = this.contractCheckSignature(id);
    if (!s.ok) return { id, ok: false, signature: s.detail, tasks: [] };
    const c = s.contract; const wd = c.workdir ? path.resolve(c.workdir) : this.root;
    const run = (crit) => {
      const v = crit.verifier;
      if (v.type === 'command') {
        if (!local && this.config.contracts?.exec_local_only !== false) return { status: 'BLOCKED', detail: 'commands run only from this machine' };
        if (this.config.contracts?.exec === false) return { status: 'BLOCKED', detail: 'running commands is switched off (contracts.exec)' };
        const r = spawn('sh', ['-c', v.cmd], { cwd: wd, timeout: (v.timeout_s || 300) * 1000 });
        const want = v.expect_exit ?? 0;
        return { status: r.status === want ? 'PASS' : 'FAIL', detail: `exit ${r.status}${r.status === want ? '' : `: ${r.error || truncate(`${r.stderr}${r.stdout}`.trim(), 300)}`}` };
      }
      if (v.type === 'file_exists') return exists(path.join(wd, v.path)) ? { status: 'PASS', detail: v.path } : { status: 'FAIL', detail: `${v.path} is missing` };
      if (v.type === 'test_exists') return exists(path.join(wd, v.test_file)) ? { status: 'PASS', detail: v.test_file } : { status: 'FAIL', detail: `${v.test_file} is missing` };
      if (v.type === 'grep') { let t = ''; try { t = fs.readFileSync(path.join(wd, v.file), 'utf8'); } catch { return { status: 'FAIL', detail: `${v.file} is missing` }; } return new RegExp(v.pattern, v.flags || '').test(t) ? { status: 'PASS', detail: `${v.file} matches` } : { status: 'FAIL', detail: `${v.file} does not match ${v.pattern}` }; }
      return { status: 'BLOCKED', detail: `${v.type} criteria are checked by a person or CI, not here` };
    };
    const tasks = c.tasks.map((t) => ({ id: t.id, title: t.title, criteria: t.criteria.map((cr) => ({ id: cr.id, statement: cr.statement || `${cr.verifier?.type || "check"} check`, mandatory: cr.mandatory !== false, ...run(cr) })) }));
    for (const t of tasks) t.status = t.criteria.every((cr) => !cr.mandatory || cr.status === 'PASS') ? 'PASS' : t.criteria.some((cr) => cr.mandatory && cr.status === 'FAIL') ? 'FAIL' : 'BLOCKED';
    const ok = tasks.every((t) => t.status === 'PASS');
    const remaining = tasks.filter((t) => t.status !== 'PASS').map((t) => ({ id: t.id, title: t.title, status: t.status, failing: t.criteria.filter((cr) => cr.mandatory && cr.status !== 'PASS').map((cr) => `${cr.statement}: ${cr.detail}`) }));
    const result = { id, ok, verdict: ok ? 'PASS' : 'FAIL', signature: s.detail, verified: now(), passed: tasks.length - remaining.length, total: tasks.length, remaining, tasks };
    // the receipt: an append-only record in the vault of every verification and its evidence
    const receipt = [`\n### ${now()} · verify · ${ok ? 'PASS' : 'FAIL'} · ${tasks.length - remaining.length}/${tasks.length} tasks`];
    for (const t of tasks) { receipt.push(`- ${t.status} ${t.id} ${t.title}`); for (const cr of t.criteria) receipt.push(`  - ${cr.status} ${cr.id} ${cr.statement} (${truncate(String(cr.detail || '').replace(/\s+/g, ' '), 200)})`); }
    const rp = `contracts/receipts/${id}.md`;
    this.append(identity, { path: rp, text: `${this._read(rp) === null ? `# Receipts for ${id}\n\nEvery verification of the signed contract, newest last.\n` : ''}${receipt.join('\n')}\n`, client, internal: true });
    this._applyMisc(this.log.append({ type: 'contract.verified', agent: identity.agent, client, data: { id, ok, tasks: Object.fromEntries(tasks.map((t) => [t.id, t.status])), failing: tasks.flatMap((t) => t.criteria.filter((cr) => cr.mandatory && cr.status !== 'PASS').map((cr) => cr.id)) } }));
    if (ok) this.write(identity, { path: `contracts/closed/${id}.json`, body: `${JSON.stringify(result, null, 2)}\n`, client });
    result.receipts = rp;
    return result;
  };

  P.contractAmend = function (identity, { id, title = null, tasks = null, client = null }) {
    const s = this.contractCheckSignature(id);
    if (!s.contract) throw new ContractError('not_found', `no signed contract ${id}`);
    const c = s.contract;
    return this.contractDraft(identity, { title: title || c.title, project: c.project, workdir: c.workdir, tasks: tasks || c.tasks, supersedes: id, client, request: c.request, provenance: c.provenance, version: (c.version || 1) + 1 });
  };

  P.contractList = function () {
    const list = (dir) => { try { return fs.readdirSync(this.abs(dir)).filter((n) => n.endsWith('.json') && !n.endsWith('.sig.json')).map((n) => n.slice(0, -5)); } catch { return []; } };
    const closed = new Set(list('contracts/closed'));
    const raw = list(SIGNED).map((id) => ({ id, c: readJson(this.abs(`${SIGNED}/${id}.json`), {}) }));
    const replaced = new Map(raw.filter((x) => x.c.supersedes).map((x) => [x.c.supersedes, x.id]));
    const signed = raw.map(({ id, c }) => ({ id, title: c.title, project: c.project, version: c.version || 1, workdir: c.workdir || null, state: closed.has(id) ? 'done' : replaced.has(id) ? 'superseded' : 'open', supersedes: c.supersedes || null, superseded_by: replaced.get(id) || null, tasks: (c.tasks || []).length }));
    const drafts = list('contracts/drafts').filter((id) => !signed.some((s) => s.id === id)).map((id) => ({ id, title: readJson(this.abs(`contracts/drafts/${id}.json`), {}).title, state: 'draft' }));
    return [...signed, ...drafts];
  };

  /** Open contracts this session signed: the Stop hook keeps the session going until they verify. */
  P.contractGate = function (session) {
    if (!session) return [];
    return this.contractList().filter((c) => c.state === 'open' && this.contractSessions.get(c.id) === session);
  };

  /**
   * "I have a project, build me X": turn the request into a contract draft. The calling AI passes the
   * requirements it inferred from the conversation, each with a check that runs on this machine; any
   * requirement without one gets the project's own test command if there is one. If a requirement
   * still has no check, nothing is drafted and the missing ones are returned to be filled in.
   */
  P.contractFromRequest = function (identity, { request, title = null, project = null, workdir = null, requirements = null, tasks = null, decisions = [], session = null, client = null }) {
    if (!request || !String(request).trim()) throw new ContractError('bad_request', 'contract_from_request needs the request text');
    const wd = workdir ? path.resolve(workdir) : null;
    title = title || truncate(String(request).trim().split('\n')[0].replace(/^(i have a project[,:.]?\s*)?(please\s+)?(can you\s+)?/i, ''), 80);
    project = project ? slug(project) : slug(title, 32);
    let built = tasks;
    const missing = [];
    if (!built) {
      const reqs = (requirements?.length ? requirements : inferRequirements(request)).map((r) => (typeof r === 'string' ? { title: r } : r));
      if (!reqs.length) throw new ContractError('bad_request', 'no requirements found in the request; pass requirements');
      const fallback = projectTestCommand(wd);
      built = reqs.map((r, i) => {
        const criteria = (r.criteria || (r.checks || (r.check ? [r.check] : [])).map((ch) => ({ statement: ch.statement || r.title, verifier: toVerifier(ch) }))).filter((cr) => cr.verifier);
        for (const f of mentionedFiles(r.title)) if (!criteria.some((cr) => cr.verifier.path === f)) criteria.push({ statement: `${f} exists`, verifier: { type: 'file_exists', path: f } });
        if (!criteria.length && fallback) criteria.push({ statement: `${r.title}: the project's tests pass`, verifier: { type: 'command', cmd: fallback } });
        if (!criteria.length) missing.push({ task: `T${i + 1}`, requirement: r.title });
        return { id: `T${i + 1}`, title: truncate(r.title, 160), requirements: [r.title], depends_on: r.depends_on || [], criteria, stop_rules: [...A.DEFAULT_STOP_RULES, STOP_AMEND] };
      });
    } else built = built.map((t) => ({ ...t, stop_rules: t.stop_rules?.length ? t.stop_rules : [...A.DEFAULT_STOP_RULES, STOP_AMEND] }));
    if (missing.length) return { status: 'needs_checks', title, project, missing, tasks: built.map((t) => ({ id: t.id, title: t.title, checks: t.criteria.length })), hint: 'Give each listed requirement a check that runs on this machine ({ file } | { cmd, expect_exit } | { grep: { file, pattern } } | { test_file }) and call memev_contract_from_request again. Checks never depend on a CI service.' };
    const d = this.contractDraft(identity, { title, project, workdir: wd, tasks: built, client, request, provenance: { session, client, decisions: decisions || [], at: now() } });
    return { status: 'draft', ...d, title, project, tasks: built.map((t) => ({ id: t.id, title: t.title, checks: t.criteria.map((cr) => cr.statement) })), next: `memev_contract_sign { id: "${d.id}" }` };
  };

  /** Where each signed contract stands: PASS/FAIL/not verified per task, from its latest verification. */
  P.contractStatus = function (identity, { id = null, project = null, all = false } = {}) {
    this._need(identity, 'read', null);
    const rows = this.contractList().filter((c) => c.state !== 'draft' && (id ? c.id === id : all || c.state === 'open') && (!project || c.project === slug(project)));
    if (id && !rows.length) throw new ContractError('not_found', `no signed contract ${id}`);
    return rows.map((row) => {
      const c = readJson(this.abs(`${SIGNED}/${row.id}.json`), { tasks: [] });
      const last = this.contractResults.get(row.id) || null;
      const tasks = c.tasks.map((t) => ({ id: t.id, title: t.title, status: last?.tasks?.[t.id] || 'NOT VERIFIED' }));
      const remaining = tasks.filter((t) => t.status !== 'PASS');
      return { ...row, signature: this.contractCheckSignature(row.id).ok ? 'ok' : 'BROKEN', last_verified: last?.at || null, passed: tasks.length - remaining.length, total: tasks.length, tasks, remaining, receipts: `contracts/receipts/${row.id}.md` };
    });
  };

  P.contractDecompose = function (identity, { scope, client = null }) {
    const out = attestDecompose(scope, { lint: 'warn' });
    const p = `contracts/proposals/${slug(scope?.prefix || 'scope', 16)}-${out.sha256.slice(0, 8)}.json`;
    this.write(identity, { path: p, body: out.bytes, client });
    return { path: p, ids: out.ids, sha256: out.sha256, warnings: out.warnings, note: 'a proposal: review it, then memev_contract_draft with its tasks and sign' };
  };
}
