// SPDX-License-Identifier: Apache-2.0
// Signed task contracts in the vault. A session drafts a contract (tasks with acceptance criteria),
// signs it with this machine's key (self-signing: the agent binds itself to the work), and cannot
// call the work done until `verify` re-runs the criteria. Signed files are immutable three ways: the
// vault refuses writes to contracts/signed/ and contracts/keys/, a pre-commit hook in the vault's git
// repository rejects changes to them, and any edit on disk breaks the signature. Changing a signed
// contract means amending: a new contract that supersedes the old one.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { configDir, randomToken, slug, now, readJson, writePrivate, exists, truncate, runAsync } from './util.mjs';
import { git } from './git.mjs';
import * as A from '../../vendor/attest/contract.mjs';
import { decompose as attestDecompose } from '../../vendor/attest/decompose.mjs';
import { sign as dsseSign, verify as dsseVerify, keyId, generateKeyPair, canonicalHash } from '../../vendor/attest/signature.mjs';

const STOP_AMEND = 'If the requirements change: do not edit this contract. Amend it (memev_contract_amend), which signs a new version that supersedes this one.';

// A remote caller supplies the pattern. It is length-capped and runs in a worker that is terminated
// when it does not finish in time, so a pathological pattern cannot hang a verify. The match blocks this
// process while it runs, so the grep time of one verify with remote patterns is capped as a whole too.
export const GREP_PATTERN_MAX = 200;
export const GREP_TIMEOUT_MS = 1000;
export const GREP_VERIFY_BUDGET_MS = 2000;
const GREP_WORKER = `
const { parentPort } = require('node:worker_threads');
parentPort.on('message', (m) => {
  const flag = new Int32Array(m.sab);
  let r = 2;
  try { r = new RegExp(m.pattern, m.flags).test(m.text) ? 1 : 0; } catch { r = 2; }
  Atomics.store(flag, 0, r);
  Atomics.store(flag, 1, 1);
  Atomics.notify(flag, 1);
});
`;
function grepMatch(pattern, flags, text, timeoutMs = GREP_TIMEOUT_MS) {
  const sab = new SharedArrayBuffer(8);
  const flag = new Int32Array(sab);
  let w;
  try { w = new Worker(GREP_WORKER, { eval: true }); } catch { return { error: 'the match could not be started' }; }
  w.on('error', () => {});
  try { w.postMessage({ pattern, flags, text, sab }); } catch { w.terminate(); return { error: 'the match could not be started' }; }
  const deadline = Date.now() + timeoutMs;
  while (Atomics.load(flag, 1) === 0) {
    if (Date.now() >= deadline) { w.terminate(); return { timeout: true }; }
    Atomics.wait(flag, 1, 0, Math.max(1, Math.min(50, deadline - Date.now())));
  }
  const r = Atomics.load(flag, 0);
  w.terminate();
  return r === 1 ? { ok: true } : r === 0 ? { ok: false } : { error: 'the pattern is not a usable regular expression' };
}

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

// The base revision: the commit a contract's work starts from. Scope and red-green criteria compare against it, and every
// criterion command sees it as MEMEV_CONTRACT_BASE. A local signature records it ({ sha, recorded_at }) inside the signed body,
// so the signature covers it; a remote-signed contract gets it at local approval, in a signed approval record.
export const BASE_ENV = 'MEMEV_CONTRACT_BASE';
const SHA40 = /^[0-9a-f]{40}$/;
/** An explicit base as a spec or draft names it: a 40-hex sha (any case) gives it lowercased; null when none is named; else throws. */
export function explicitBase(b) {
  if (b === undefined || b === null) return null;
  const sha = typeof b === 'string' ? b : b && typeof b === 'object' ? b.sha : undefined;
  if (typeof sha !== 'string' || !/^[0-9a-fA-F]{40}$/.test(sha)) throw new ContractError('bad_request', 'the base must be a commit sha of 40 hex characters');
  return sha.toLowerCase();
}
/** The commit HEAD names in a git workdir, or null when the workdir is not a git checkout. Only for a local caller. */
function headOf(wd) {
  if (!wd) return null;
  const r = git(path.resolve(wd), ['rev-parse', '--verify', '-q', 'HEAD^{commit}']);
  return r.ok && SHA40.test(r.out) ? r.out : null;
}
// The red-green verifier runs a criterion's command twice: in a temporary worktree of the base (red, which must fail on an
// assertion) and in the workdir (green, which must pass). Its worktrees sit under the system temp folder, named with this prefix,
// the owning process id and a random part, so a later verify can tell its own stale ones from anyone else's.
export const RED_GREEN_TIMEOUT_S = 900;
export const VERIFY_WORKTREE_PREFIX = 'memev-verify-';
const RUN_OUTPUT_MAX = 1024 * 1024;
const OWN_WORKTREE = /^memev-verify-(\d+)-[0-9a-f]+$/;
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const tmpBase = () => fs.realpathSync(os.tmpdir());
/** git as verify runs it on a workdir: hooks off (an empty hooks folder), no fsmonitor. */
function vgit(cwd, args) {
  const hooks = path.join(tmpBase(), 'memev-verify-no-hooks');
  fs.mkdirSync(hooks, { recursive: true });
  return git(cwd, ['-c', `core.hooksPath=${hooks}`, '-c', 'core.fsmonitor=', ...args]);
}
/** The worktrees git lists for the repository at `top`: { path, locked, prunable }. */
function worktreeList(top) {
  const r = vgit(top, ['worktree', 'list', '--porcelain']);
  if (!r.ok) return [];
  return r.out.split(/\n\n+/).map((b) => { const l = b.split('\n'); const p = l.find((x) => x.startsWith('worktree '))?.slice(9); return p ? { path: p, locked: l.some((x) => x === 'locked' || x.startsWith('locked ')), prunable: l.some((x) => x.startsWith('prunable')) } : null; }).filter(Boolean);
}
/**
 * Remove the stale worktrees an earlier verify left (its process killed): only those under this engine's prefix in the temp
 * folder whose owning process is gone, never a locked one, never anyone else's, and never with a bare git worktree prune.
 */
export function pruneStaleVerifyWorktrees(top) {
  const base = tmpBase();
  for (const w of worktreeList(top)) {
    const m = OWN_WORKTREE.exec(path.basename(w.path));
    if (!m || path.dirname(w.path) !== base || w.locked || pidAlive(Number(m[1]))) continue;
    vgit(top, ['worktree', 'remove', '--force', w.path]);
    fs.rmSync(w.path, { recursive: true, force: true });
  }
}
/** NODE_OPTIONS without any test reporter (a second reporter makes node refuse to run a test). */
const stripReporters = (opts) => String(opts || '').replace(/--test-reporter(-destination)?(=|\s+)\S+/g, '').trim();
/** NODE_OPTIONS with the TAP reporter and no other. A command that names a reporter itself is left to it. */
const tapOptions = (opts) => `${stripReporters(opts)} --test-reporter=tap`.trim();
/** One run of a criterion command: the test path passed as one argument ($1), never spliced into the shell text. */
async function runCriterion(cmd, cwd, env, testFile, timeoutS) {
  const sh = String(cmd).split('{test}').join('"$1"');
  const r = await runAsync('sh', ['-c', sh, 'sh', testFile], { cwd, env: { ...env, NODE_OPTIONS: /--test-reporter/.test(sh) ? stripReporters(env.NODE_OPTIONS) : tapOptions(env.NODE_OPTIONS) }, timeout: timeoutS * 1000, maxBuffer: RUN_OUTPUT_MAX });
  return { status: r.status, timedOut: r.timedOut, tooLarge: r.tooLarge, failed: r.error && !r.timedOut && !r.tooLarge && r.status === null && !/^ended by /.test(r.error) ? r.error : null, out: `${r.stdout}${r.stderr}` };
}
/** Why a run that exited non-zero did not fail on an assertion, from its TAP output; null when it did (or it printed no TAP). */
function notAnAssertion(out) {
  if (!/^TAP version/m.test(out)) return null;
  if (/code: 'ERR_ASSERTION'|name: 'AssertionError'/.test(out)) return null;
  if (/ERR_MODULE_NOT_FOUND|SyntaxError|Cannot find module|does not provide an export named/.test(out)) return 'load error';
  const name = /name: '([A-Za-z]*Error)'/.exec(out)?.[1];
  return name ? `it failed with ${name} before any assertion` : 'it failed without a failing assertion';
}
/** Whether a TAP run printed a passing test line other than a file line. */
const passingLine = (out) => out.split('\n').some((l) => { const m = /^\s*ok \d+ - (.*)$/.exec(l); return m && !/# (SKIP|TODO)/.test(m[1]) && !/\.test\.m?js$/.test(m[1].trim()); });

/**
 * The last JSON object a command printed: the last top-level { ... } in `text` that parses (a pretty-printed object counts
 * as one, an object nested inside it does not). null when there is none.
 */
export function lastJsonObject(text) {
  const src = String(text ?? '');
  let last = null;
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    let depth = 0; let inStr = false; let esc = false; let end = -1;
    for (let j = open; j < src.length; j++) {
      const ch = src[j];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true; else if (ch === '{') depth++; else if (ch === '}' && --depth === 0) { end = j; break; }
    }
    let parsed;
    if (end > 0) { try { parsed = JSON.parse(src.slice(open, end + 1)); } catch { parsed = undefined; } }
    if (parsed !== undefined && parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) { last = parsed; i = end + 1; } else i = open + 1;
  }
  return last;
}
/** The value at a dotted path of own properties, or { missing: true }. */
export function dottedValue(obj, key) {
  let cur = obj;
  for (const part of String(key ?? '').split('.')) {
    if (part === '' || cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, part)) return { missing: true };
    cur = cur[part];
  }
  return { value: cur };
}
const METRIC_OPS = { '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b, '==': (a, b) => a === b };
const metricStamp = (p) => { try { const s = fs.statSync(p, { bigint: true }); return `${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`; } catch { return null; } };
/** The environment of a criterion command: this process's, with MEMEV_CONTRACT_BASE set to the base, or removed when there is none. */
export function criterionEnv(base, env = process.env) {
  const out = { ...env };
  delete out[BASE_ENV];
  // a criterion command is a process of its own, never a child of a test runner the caller happens to run under (a node test
  // started with NODE_TEST_CONTEXT set reports to that runner and exits 0 whatever its tests did)
  delete out.NODE_TEST_CONTEXT;
  if (base) out[BASE_ENV] = base;
  return out;
}

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

  P.contractDraft = function (identity, { title, project = null, workdir = null, tasks = [], supersedes = null, client = null, request = null, provenance = null, version = null, base = null }) {
    if (!title) throw new ContractError('bad_request', 'a contract needs a title');
    if (!Array.isArray(tasks) || !tasks.length) throw new ContractError('bad_request', 'a contract needs at least one task');
    // an explicit base is checked before anything is written: only a 40-hex sha, never a ref or anything git could read as an option
    const baseSha = explicitBase(base);
    const id = `k-${slug(title, 24)}-${randomToken(3)}`;
    const c = { ...A.skeleton(project || 'memev'), id, title, workdir, created: now(), version: version || 1, ...(baseSha ? { base: baseSha } : {}), ...(supersedes ? { supersedes } : {}), ...(request ? { request: truncate(String(request), 4000) } : {}), ...(provenance ? { provenance } : {}), tasks: tasks.map((t, i) => A.makeTask({ id: t.id || `T${i + 1}`, title: t.title, phase: t.phase || 'implement', depends_on: t.depends_on || [], requirements: t.requirements || [], description: t.description || '', scope: t.scope || ['**'], criteria: t.criteria || [], stop_rules: t.stop_rules || [] })) };
    const errs = A.validate(c);
    if (errs.length) throw new ContractError('invalid', `the contract is not valid: ${errs.slice(0, 5).join('; ')}`);
    this.write(identity, { path: `contracts/drafts/${id}.json`, body: `${JSON.stringify(c, null, 2)}\n`, client });
    return { id, path: `contracts/drafts/${id}.json`, tasks: c.tasks.length };
  };

  P.contractSign = function (identity, { id, client = null, session = null, local = true }) {
    this._need(identity, 'write', `${SIGNED}/${id}.json`);
    const draft = this._read(`contracts/drafts/${id}.json`);
    if (!draft) throw new ContractError('not_found', `no draft contract ${id}`);
    if (this._read(`${SIGNED}/${id}.json`) !== null) throw new ContractError('immutable', `${id} is already signed; amend it instead`);
    const c = JSON.parse(draft);
    const errs = A.validate(c); if (errs.length) throw new ContractError('invalid', errs.join('; '));
    // a draft is a note any contracts/** token can write, so the check contractDraft makes is made again here (issue 257)
    if (!Array.isArray(c.tasks) || !c.tasks.length) throw new ContractError('bad_request', 'a contract needs at least one task');
    const key = signingKey(this.opts.keyDir || path.join(configDir(), 'keys'));
    const origin = local ? 'local' : 'remote';
    c.origin = origin;
    // the base revision, recorded before the signature is made so the signature covers it: the draft's explicit base, else the
    // workdir's HEAD when the workdir is a git checkout. A draft is a note other tokens can write, so its base is checked again.
    // A remote caller's contract records none and runs no git here: its base is recorded at local approval.
    const explicit = explicitBase(c.base);
    delete c.base;
    if (local) { const sha = explicit || headOf(c.workdir); if (sha) c.base = { sha, recorded_at: now() }; }
    const env_ = dsseSign(c, key.priv);
    const body = `${JSON.stringify(c, null, 2)}\n`;
    if (this._read(`${KEYS}/${key.id}.pub`) === null) this.write(identity, { path: `${KEYS}/${key.id}.pub`, body: key.pub, client, internal: true });
    this.write(identity, { path: `${SIGNED}/${id}.json`, body, client, internal: true });
    this.write(identity, { path: `${SIGNED}/${id}.sig.json`, body: `${JSON.stringify(env_, null, 2)}\n`, client, internal: true });
    this._applyMisc(this.log.append({ type: 'contract.signed', path: null, agent: identity.agent, client, data: { id, hash: canonicalHash(c), keyid: key.id, session, supersedes: c.supersedes || null, origin, base: c.base?.sha || null } }));
    // the signed contract is a memory: a decision anyone can recall, linked to its project, the
    // session that signed it, the decisions it rests on and the version it replaces (provenance)
    const project = c.project && c.project !== 'memev' ? c.project : null;
    const mem = this.remember(identity, { kind: 'decision', project, client, text: `Signed contract ${id} (v${c.version || 1}) "${c.title}"${c.supersedes ? `, superseding ${c.supersedes}` : ''}: ${c.tasks.map((t) => `${t.id} ${t.title}`).join('; ')}. Status: memev_contract_status ${id}.`, why: c.request ? truncate(c.request.replace(/\s+/g, ' '), 300) : null });
    const node = `contract ${id}`;
    if (project) this.link(identity, { from: node, to: project, type: 'part_of', why: 'contract for this project', client });
    if (session || c.provenance?.session) this.link(identity, { from: node, to: `session ${String(session || c.provenance.session).slice(0, 16)}`, type: 'derived_from', why: 'signed in this conversation', client });
    for (const d of c.provenance?.decisions || []) this.link(identity, { from: node, to: String(d), type: 'derived_from', why: 'a decision the contract rests on', client });
    if (c.supersedes) this.link(identity, { from: node, to: `contract ${c.supersedes}`, type: 'supersedes', why: 'new version', client });
    return { id, signed: true, version: c.version || 1, supersedes: c.supersedes || null, hash: canonicalHash(c), keyid: key.id, path: `${SIGNED}/${id}.json`, origin, base: c.base?.sha || null, memory: mem.path || null, next: 'build the tasks in order; run memev_contract_verify after each one' };
  };

  P.contractApprove = function (identity, { id, local = true }) {
    if (!local) throw new ContractError('forbidden', 'approval is a local operator action; run it on this machine (memev contract approve ' + id + ')');
    this._need(identity, 'admin', null);
    if (this._read(`${SIGNED}/${id}.json`) === null) throw new ContractError('not_found', `contract ${id} is not signed`);
    // the approval sits beside the signed contract, under the protected path: no plain write can create it
    // (a remote caller included), and it is written once, since the vault hook refuses a change under signed/
    if (this._contractApproved(id)) return { approved: true, id };
    // the base of a remote-signed contract is the workdir's HEAD now, at local approval. The record is signed with this machine's
    // contract key, so an edit of the recorded base on disk is caught before any criterion runs.
    let wd = null; try { wd = JSON.parse(this._read(`${SIGNED}/${id}.json`)).workdir || null; } catch { wd = null; }
    const sha = headOf(wd);
    const key = signingKey(this.opts.keyDir || path.join(configDir(), 'keys'));
    const body = { id, at: now(), by: identity.agent, base: sha ? { sha, recorded_at: now() } : null };
    if (this._read(`${KEYS}/${key.id}.pub`) === null) this.write(identity, { path: `${KEYS}/${key.id}.pub`, body: key.pub, client: null, internal: true });
    this.write(identity, { path: `${SIGNED}/${id}.approval.txt`, body: `${JSON.stringify({ ...body, sig: dsseSign(body, key.priv) }, null, 2)}\n`, client: null, internal: true });
    this._applyMisc(this.log.append({ type: 'contract.approved', path: null, agent: identity.agent, data: { id, base: sha } }));
    return { approved: true, id, base: sha };
  };

  /** The base an approval recorded: { sha } (null for an approval made before bases were recorded), or { problem } when the record was changed. */
  P._approvalBase = function (id) {
    let a; try { a = JSON.parse(this._read(`${SIGNED}/${id}.approval.txt`)); } catch { return { problem: 'approval record changed' }; }
    if (!a || typeof a !== 'object') return { problem: 'approval record changed' };
    if (a.sig === undefined && (a.base === undefined || a.base === null)) return { sha: null };
    const kid = a.sig?.signatures?.[0]?.keyid;
    const pub = /^[0-9a-f]{16}$/.test(String(kid)) ? this._read(`${KEYS}/${kid}.pub`) : null;
    const { sig, ...body } = a;
    if (!pub || !dsseVerify(body, sig, pub).ok || body.id !== id) return { problem: 'approval record changed' };
    const sha = body.base?.sha ?? null;
    if (sha !== null && !SHA40.test(String(sha))) return { problem: 'approval record changed' };
    return { sha };
  };

  P._contractOrigin = function (id) {
    const body = this._read(`${SIGNED}/${id}.json`);
    if (!body) return null;
    try { return JSON.parse(body).origin || 'local'; } catch { return 'local'; }
  };

  P._contractApproved = function (id) {
    return this._read(`${SIGNED}/${id}.approval.txt`) !== null;
  };

  const _origOpenContracts = P._openContracts;
  P._openContracts = function () {
    return _origOpenContracts.call(this).map((k) => ({ ...k, origin: this._contractOrigin(k.id) || 'local', approved: this._contractApproved(k.id) }));
  };

  P._confinePath = function (workdir, p, { inVault = false } = {}) {
    const raw = String(p);
    if (path.isAbsolute(raw)) throw new ContractError('forbidden', `absolute paths are not allowed: ${p}`);
    if (raw.split(/[\\/]/).includes('..')) throw new ContractError('forbidden', `path escapes the vault: ${p}`);
    const abs = path.resolve(workdir, raw);
    const rel = path.relative(this.root, abs);
    if (inVault && (rel.startsWith('..') || path.isAbsolute(rel))) throw new ContractError('forbidden', `outside the vault: ${p} in ${workdir}`);
    return abs;
  };

  P.contractCheckSignature = function (id) {
    const body = this._read(`${SIGNED}/${id}.json`); const sig = this._read(`${SIGNED}/${id}.sig.json`);
    if (!body || !sig) return { ok: false, detail: `${id} is not signed` };
    let c, env; try { c = JSON.parse(body); env = JSON.parse(sig); } catch { return { ok: false, detail: 'unreadable contract or signature' }; }
    // the key id names a file, so only the 16-hex form keyId() makes is accepted (issue 247: '../drafts/k' named a note
    // any contracts/** token can write); and the signed body must be the contract asked for, not another one copied over it
    const kid = env.signatures?.[0]?.keyid;
    if (!/^[0-9a-f]{16}$/.test(String(kid))) return { ok: false, detail: 'the signature names no valid key id' };
    if (c?.id !== undefined && c.id !== id) return { ok: false, detail: `the signed body is contract ${String(c.id).slice(0, 60)}, not ${id}` };
    const pub = this._read(`${KEYS}/${kid}.pub`);
    if (!pub) return { ok: false, detail: 'the signing key is not in contracts/keys' };
    return { ...dsseVerify(c, env, pub), contract: c };
  };

  /** Re-run every criterion. Commands run only on this machine and only in the contract's workdir. */
  P.contractVerify = async function (identity, { id, client = null }, { local = true } = {}) {
    this._need(identity, 'read', null);
    const s = this.contractCheckSignature(id);
    if (!s.ok) return { id, ok: false, signature: s.detail, tasks: [] };
    const c = s.contract; const wd = c.workdir ? path.resolve(c.workdir) : this.root;
    const origin = c.origin || 'local';
    const approved = this._contractApproved(id);
    const needsApproval = origin === 'remote' && !approved;
    // file-based criteria stay inside the vault root when the caller is remote or the contract was signed
    // remotely (its receipt is readable remotely, so a local verify must not prove anything outside it either)
    const inVault = !local || origin === 'remote';
    // the base: a locally signed contract's own (under its signature), a remote-signed one's from its signed approval record;
    // a changed approval record stops the verify before any criterion runs
    let base = null; let baseNote = null;
    if (origin === 'remote') {
      if (approved) { const ap = this._approvalBase(id); if (ap.problem) return { id, ok: false, verdict: 'BLOCKED', signature: s.detail, detail: ap.problem, tasks: [] }; base = ap.sha; }
    } else if (c.base !== undefined && c.base !== null) {
      const sha = typeof c.base === 'object' ? c.base.sha : c.base;
      if (typeof sha === 'string' && SHA40.test(sha)) base = sha; else baseNote = 'the recorded base is not a 40-hex commit sha';
    }
    const env = criterionEnv(base);
    // scope and red-green criteria compare with the base: without one, or with one this workdir's HEAD does not descend from,
    // they are BLOCKED and nothing runs. The base passed to git is always a checked 40-hex sha, never an option or a ref.
    let baseProblem;
    const baseCheck = () => {
      if (baseProblem !== undefined) return baseProblem;
      if (!base) return (baseProblem = `no base revision recorded${baseNote ? ` (${baseNote})` : ''}`);
      if (!git(wd, ['cat-file', '-e', `${base}^{commit}`]).ok) return (baseProblem = headOf(wd) ? `base ${base} is not a commit in the workdir` : 'the workdir is not a git checkout');
      const a = git(wd, ['merge-base', '--is-ancestor', base, 'HEAD']);
      return (baseProblem = a.status === 0 ? null : a.status === 1 ? `base ${base} is not an ancestor of HEAD` : `base ${base} could not be compared with HEAD`);
    };
    // the same callers supply grep patterns: past the budget their remaining grep criteria fail unchecked
    let grepLeft = inVault ? GREP_VERIFY_BUDGET_MS : Infinity;
    // red-green (SR-0.03 task 3): red in a temporary worktree of the base holding the head's test-side files, green in the workdir
    const redGreen = async (v) => {
      const where = inVault ? 'the vault' : 'the workdir';
      const inside = (p) => { const raw = String(p ?? ''); if (!raw || path.isAbsolute(raw) || raw.split(/[\\/]/).includes('..')) return null; try { return this._confinePath(wd, raw, { inVault }); } catch { return null; } };
      const testAbs = inside(v.test_file);
      if (!testAbs) return { status: 'BLOCKED', detail: `the test file ${v.test_file} is outside ${where}` };
      if (!exists(testAbs)) return { status: 'FAIL', detail: `${v.test_file} is missing` };
      const support = Array.isArray(v.support_files) ? v.support_files : [];
      for (const f of support) if (!inside(f)) return { status: 'BLOCKED', detail: `support file ${f} is outside ${where}` };
      const top = vgit(wd, ['rev-parse', '--show-toplevel']);
      if (!top.ok) return { status: 'BLOCKED', detail: 'the workdir is not a git checkout' };
      const sub = path.relative(fs.realpathSync(top.out), fs.realpathSync(wd));
      const timeoutS = v.timeout_s || RED_GREEN_TIMEOUT_S;
      pruneStaleVerifyWorktrees(top.out);
      const wt = path.join(tmpBase(), `${VERIFY_WORKTREE_PREFIX}${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
      let red;
      try {
        const add = vgit(top.out, ['worktree', 'add', '--detach', '--quiet', wt, base]);
        if (!add.ok) return { status: 'BLOCKED', detail: `the base worktree could not be added: ${truncate(add.err, 200)}` };
        const redCwd = path.join(wt, sub);
        // the head's test-side files, so the code under test is the only difference between the two runs
        for (const rel of [v.test_file, ...support, 'test/helpers', 'test/fixtures']) {
          const from = path.join(wd, rel);
          if (exists(from)) fs.cpSync(from, path.join(redCwd, rel), { recursive: true });
        }
        red = await runCriterion(v.cmd, redCwd, env, v.test_file, timeoutS);
      } finally {
        vgit(top.out, ['worktree', 'remove', '--force', wt]);
        fs.rmSync(wt, { recursive: true, force: true });
      }
      const green = await runCriterion(v.cmd, wd, env, v.test_file, timeoutS);
      const exits = `red exit ${red.status}, green exit ${green.status}, base ${base}`;
      const broken = (r, which) => r.failed ? `the ${which} run could not start: ${r.failed}` : r.timedOut ? `the ${which} run timed out after ${timeoutS} s` : r.tooLarge ? `the ${which} run's output is too large (over ${RUN_OUTPUT_MAX} bytes)` : r.status === 127 ? `the ${which} run's command was not found (exit 127)` : null;
      const rb = broken(red, 'red');
      if (rb) return { status: 'BLOCKED', detail: `${rb}; ${exits}` };
      if (red.status === 0) return { status: 'FAIL', detail: `${exits}: the test passes without the change, so it proves nothing` };
      const why = notAnAssertion(red.out);
      if (why) return { status: 'BLOCKED', detail: `the red run did not fail on an assertion (${why}); ${exits}` };
      const gb = broken(green, 'green');
      if (gb) return { status: 'BLOCKED', detail: `${gb}; ${exits}` };
      if (green.status !== 0) return { status: 'FAIL', detail: exits };
      if (!passingLine(green.out)) return { status: 'BLOCKED', detail: `the green run printed no passing test line; ${exits}` };
      return { status: 'PASS', detail: exits };
    };
    // the gates every criterion that runs a command passes first (command, metric and red-green alike), with the same details
    const commandGate = () => {
      if (needsApproval) return { status: 'BLOCKED', detail: 'remote-signed contract needs local operator approval (memev contract approve ' + id + ')' };
      if (!local && this.config.contracts?.exec_local_only !== false) return { status: 'BLOCKED', detail: 'commands run only from this machine' };
      if (this.config.contracts?.exec === false) return { status: 'BLOCKED', detail: 'running commands is switched off (contracts.exec)' };
      return null;
    };
    // metric (SR-0.03 task 4): the command's last JSON object, or the file it writes, compared with a threshold
    const metric = async (v) => {
      const op = METRIC_OPS[v.op];
      if (!op) return { status: 'FAIL', detail: `the operator ${JSON.stringify(v.op)} is not one of <, <=, >, >=, ==` };
      if (typeof v.value !== 'number' || !Number.isFinite(v.value)) return { status: 'FAIL', detail: 'the threshold value is not a number' };
      if (!v.key || typeof v.key !== 'string') return { status: 'FAIL', detail: 'the key is missing' };
      let file = null;
      if (v.output_file !== undefined && v.output_file !== null) { try { file = this._confinePath(wd, v.output_file, { inVault }); } catch (e) { return { status: 'BLOCKED', detail: e.message }; } }
      const cpus = os.cpus().length || 1;
      const load = os.loadavg()[0];
      const max = c.defaults?.max_load_per_cpu;
      const where = `${cpus} CPU${cpus === 1 ? '' : 's'}, 1-minute load ${load.toFixed(2)}`;
      if (typeof max === 'number' && load / cpus > max) return { status: 'BLOCKED', detail: `machine busy: load per CPU ${(load / cpus).toFixed(2)} is above ${max}, so the command was not run (${where})` };
      const before = file ? metricStamp(file) : null;
      const r = await runAsync('sh', ['-c', v.cmd], { cwd: wd, env, timeout: (v.timeout_s || 300) * 1000 });
      if (r.timedOut) return { status: 'FAIL', detail: `the command timed out after ${v.timeout_s || 300} s` };
      if (r.status === 127) return { status: 'BLOCKED', detail: `the command was not found (exit 127): ${truncate(`${r.stderr}${r.stdout}`.trim(), 200)}` };
      if (r.status !== 0) return { status: 'FAIL', detail: `the command exited ${r.status}${r.error ? ` (${r.error})` : ''}: ${truncate(`${r.stderr}${r.stdout}`.trim(), 200)}` };
      let text = r.stdout;
      if (file) {
        const after = metricStamp(file);
        if (after === null || after === before) return { status: 'FAIL', detail: 'output_file not written by this run' };
        try { text = fs.readFileSync(file, 'utf8'); } catch { return { status: 'FAIL', detail: 'output_file not written by this run' }; }
      }
      const obj = lastJsonObject(text);
      if (!obj) return { status: 'FAIL', detail: 'no JSON object in the output' };
      const got = dottedValue(obj, v.key);
      if (got.missing) return { status: 'FAIL', detail: `the key ${v.key} is not in the output` };
      if (typeof got.value !== 'number' || !Number.isFinite(got.value)) return { status: 'FAIL', detail: `${v.key} is not a number (${truncate(JSON.stringify(got.value), 60)})` };
      const ok = op(got.value, v.value);
      return { status: ok ? 'PASS' : 'FAIL', detail: `${v.key} = ${got.value}, wanted ${v.op} ${v.value} (measured ${got.value}, threshold ${v.value}, ${where})` };
    };
    const run = async (crit) => {
      const v = crit.verifier;
      if (v.type === 'command') {
        const g = commandGate(); if (g) return g;
        const r = await runAsync('sh', ['-c', v.cmd], { cwd: wd, env, timeout: (v.timeout_s || 300) * 1000 });
        const want = v.expect_exit ?? 0;
        return { status: r.status === want ? 'PASS' : 'FAIL', detail: `exit ${r.status}${r.status === want ? '' : `: ${r.error || truncate(`${r.stderr}${r.stdout}`.trim(), 300)}`}` };
      }
      if (v.type === 'file_exists') { let p; try { p = this._confinePath(wd, v.path, { inVault }); } catch (e) { return { status: 'BLOCKED', detail: e.message }; } return exists(p) ? { status: 'PASS', detail: v.path } : { status: 'FAIL', detail: `${v.path} is missing` }; }
      if (v.type === 'test_exists') { let p; try { p = this._confinePath(wd, v.test_file, { inVault }); } catch (e) { return { status: 'BLOCKED', detail: e.message }; } return exists(p) ? { status: 'PASS', detail: v.test_file } : { status: 'FAIL', detail: `${v.test_file} is missing` }; }
      if (v.type === 'grep') { let p; try { p = this._confinePath(wd, v.file, { inVault }); } catch (e) { return { status: 'BLOCKED', detail: e.message }; } const pat = String(v.pattern ?? ''); if (!pat) return { status: 'FAIL', detail: 'the pattern is missing' }; if (pat.length > GREP_PATTERN_MAX) return { status: 'FAIL', detail: `a pattern over ${GREP_PATTERN_MAX} characters is not checked` }; let t = ''; try { t = fs.readFileSync(p, 'utf8'); } catch { return { status: 'FAIL', detail: `${v.file} is missing` }; } if (grepLeft <= 0) return { status: 'FAIL', detail: 'not checked: the grep time for this verify is used up' }; const limit = Math.min(GREP_TIMEOUT_MS, grepLeft); const g0 = Date.now(); const m = grepMatch(pat, String(v.flags || ''), t, limit); grepLeft -= Date.now() - g0; if (m.timeout) return { status: 'FAIL', detail: `the pattern did not finish within ${limit} ms and is not checked` }; if (m.error) return { status: 'FAIL', detail: 'the pattern is not a usable regular expression' }; return m.ok ? { status: 'PASS', detail: `${v.file} matches` } : { status: 'FAIL', detail: `${v.file} does not match ${v.pattern}` }; }
      if (v.type === 'metric' || v.type === 'test_red_green') { const g = commandGate(); if (g) return g; }
      if (v.type === 'metric') return metric(v);
      if (v.type === 'scope' || v.type === 'test_red_green') { const b = baseCheck(); if (b) return { status: 'BLOCKED', detail: b }; }
      if (v.type === 'test_red_green') return redGreen(v);
      return { status: 'BLOCKED', detail: `${v.type} criteria are checked by a person or CI, not here` };
    };
    const tasks = [];
    for (const t of c.tasks) {
      const criteria = [];
      for (const cr of t.criteria) criteria.push({ id: cr.id, statement: cr.statement || `${cr.verifier?.type || "check"} check`, mandatory: cr.mandatory !== false, ...(await run(cr)) });
      tasks.push({ id: t.id, title: t.title, criteria });
    }
    // behaviour criteria (a command, red-green or metric run, a scope check) apart from document checks (grep, file_exists, test_exists)
    const DOCUMENT_CHECKS = new Set(['grep', 'file_exists', 'test_exists']);
    const kindOf = new Map(c.tasks.flatMap((t) => t.criteria.map((cr) => [cr, DOCUMENT_CHECKS.has(cr.verifier?.type) ? 'documents' : 'behaviour'])));
    const counts = { behaviour: { passed: 0, total: 0 }, documents: { passed: 0, total: 0 } };
    c.tasks.forEach((t, i) => {
      tasks[i].behaviour = { passed: 0, total: 0 }; tasks[i].documents = { passed: 0, total: 0 };
      t.criteria.forEach((cr, j) => { const k = kindOf.get(cr); const pass = tasks[i].criteria[j].status === 'PASS' ? 1 : 0; for (const o of [tasks[i][k], counts[k]]) { o.total++; o.passed += pass; } });
    });
    for (const t of tasks) t.status = t.criteria.every((cr) => !cr.mandatory || cr.status === 'PASS') ? 'PASS' : t.criteria.some((cr) => cr.mandatory && cr.status === 'FAIL') ? 'FAIL' : 'BLOCKED';
    const ok = tasks.every((t) => t.status === 'PASS');
    const remaining = tasks.filter((t) => t.status !== 'PASS').map((t) => ({ id: t.id, title: t.title, status: t.status, failing: t.criteria.filter((cr) => cr.mandatory && cr.status !== 'PASS').map((cr) => `${cr.statement}: ${cr.detail}`) }));
    const result = { id, ok, verdict: ok ? 'PASS' : 'FAIL', signature: s.detail, verified: now(), passed: tasks.length - remaining.length, total: tasks.length, behaviour: counts.behaviour, documents: counts.documents, remaining, tasks };
    // the receipt: an append-only record in the vault of every verification and its evidence
    const receipt = [`\n### ${now()} · verify · ${ok ? 'PASS' : 'FAIL'} · ${tasks.length - remaining.length}/${tasks.length} tasks`];
    for (const t of tasks) { receipt.push(`- ${t.status} ${t.id} ${t.title}`); for (const cr of t.criteria) receipt.push(`  - ${cr.status} ${cr.id} ${cr.statement} (${truncate(String(cr.detail || '').replace(/\s+/g, ' '), 200)})`); }
    const rp = `contracts/receipts/${id}.md`;
    this.append(identity, { path: rp, text: `${this._read(rp) === null ? `# Receipts for ${id}\n\nEvery verification of the signed contract, newest last.\n` : ''}${receipt.join('\n')}\n`, client, internal: true });
    this._applyMisc(this.log.append({ type: 'contract.verified', agent: identity.agent, client, data: { id, ok, tasks: Object.fromEntries(tasks.map((t) => [t.id, t.status])), failing: tasks.flatMap((t) => t.criteria.filter((cr) => cr.mandatory && cr.status !== 'PASS').map((cr) => cr.id)) } }));
    if (ok) this.write(identity, { path: `contracts/closed/${id}.json`, body: `${JSON.stringify(result, null, 2)}\n`, client, internal: true });
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
    // a newer version retires the one it supersedes only once it was signed on this computer and its own verify passed:
    // a signed draft alone, made by any token, took a contract out of both gates (issue 257)
    const replaced = new Map(raw.filter((x) => x.c.supersedes && x.c.origin === 'local' && closed.has(x.id)).map((x) => [x.c.supersedes, x.id]));
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
