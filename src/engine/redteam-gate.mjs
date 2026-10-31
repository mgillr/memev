// SPDX-License-Identifier: Apache-2.0
// gate-version: 1
// The red-team gate: whether a contract spec may be signed, judged from its red-team record. A spec
// contracts/<area>/specs/<id>-*.json is SIGNABLE only when contracts/<area>/redteam/<id>.json holds
// reviewer-signed rounds that end clean on the spec as it is now (or with a stop decision signed by a
// contract-signing key), every answer is dispositioned, nothing the earlier rounds required was
// weakened, and the code the reviewer read has not changed since. scripts/gate/redteam-gate.mjs is the
// command line over this module; the engine's draft and sign paths call evaluate() directly.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { canonical, canonicalHash, keyId, verify as dsseVerify, PAYLOAD_TYPE } from '../../vendor/attest/signature.mjs';
import { makeTask } from '../../vendor/attest/contract.mjs';
import { matchAny } from '../../vendor/attest/util.mjs';

export const GATE_VERSION = 1;
export const SCHEMA = 'memev-redteam/1';

/** Every reason code the gate can give, in the order it checks them. */
export const RULES = Object.freeze(['schema', 'spec_id', 'rounds_contiguous', 'last_clean', 'last_high', 'hash', 'dispositions_all_rounds', 'added_verbatim', 'rejected_reason', 'never_weakens', 'red_green_required', 'head_stale_src', 'review_sig', 'stop_decision']);

/**
 * The reviewer public keys the gate accepts on a round, a closing envelope or nothing else. Key id
 * 1f6b4e7c00729bc7 (keyId() of vendor/attest/signature.mjs). Its private half is held by the reviewer
 * and is never in this repository. A key under contracts/keys/ is refused here even if listed.
 */
export const REVIEWER_KEYS = Object.freeze([
  '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAkYrfYi60t6caY9cmv/YvyKldeg4Ten4AKI7Q7Q/mwG4=\n-----END PUBLIC KEY-----\n',
]);

/** canonicalHash of signed contracts that predate the gate and so have no red-team record. */
export const GRANDFATHERED = Object.freeze([
  'ef3125bf97ed5b6d0fccf31824a4069c752030549f2cd7e42403872ca0c03fad', // contracts/signed/k-memory-quality-multiling-4468b8.json
]);

export const DEFAULT_SPEC_DIRS = Object.freeze(['contracts/seed-readiness/specs', 'contracts/quality-loop/specs']);

// Fields the builder writes after the reviewer answered. A round's own signature leaves them out; the next
// round's signature (which covers the previous round in full) or the closing envelope covers them.
const ROUND_BUILDER = ['sig', 'closing', 'amendments', 'folded'];
const ANSWER_BUILDER = ['disposition', 'reason', 'folded_as'];
const SEVERITIES = ['high', 'medium', 'low'];
const EXEMPT_KINDS = ['docs', 'evidence'];
const CRITERION_KEYS = ['statement', 'verifier', 'id', 'mandatory'];

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const short = (s, n = 160) => { const t = String(s ?? '').replace(/\s+/g, ' '); return t.length > n ? `${t.slice(0, n)}...` : t; };
const posix = (p) => p.split(path.sep).join('/');
const omit = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/** sha256 of the spec as canonical JSON (sorted keys, no whitespace) with workdir null. */
export const specSha256 = (spec) => canonicalHash({ ...spec, workdir: null });

/** The id a spec file names: QL-1.01 for contracts/quality-loop/specs/QL-1.01-red-team-gate.json. */
export function specIdOf(specPath) {
  const b = path.basename(specPath).replace(/\.json$/i, '');
  const m = /^([A-Za-z][A-Za-z0-9]*-\d+(?:\.\d+)*)/.exec(b);
  return m ? m[1] : b;
}

/** Where a spec's record, snapshots and manifest live. */
export function locate(specAbs, id = specIdOf(specAbs)) {
  const dir = path.dirname(specAbs);
  const area = path.basename(dir) === 'specs' ? path.dirname(dir) : dir;
  const redteam = path.join(area, 'redteam');
  return { area, redteam, record: path.join(redteam, `${id}.json`), snapshot: (n) => path.join(redteam, `${id}.r${n}.spec.json`), manifest: path.join(area, 'manifest.json') };
}

/** The first key that an object in this (valid) JSON text holds twice, as a path, or null. */
export function duplicateKey(text) {
  const stack = []; // { obj: bool, keys: Set, want: bool, at: string }
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      const top = stack[stack.length - 1];
      if (top && top.obj && top.want) {
        const k = JSON.parse(text.slice(i, j + 1));
        if (top.keys.has(k)) return `${top.at}/${k}`;
        top.keys.add(k); top.want = false; top.last = k;
      }
      i = j + 1; continue;
    }
    if (c === '{' || c === '[') {
      const top = stack[stack.length - 1];
      const at = top ? `${top.at}/${top.obj ? top.last : top.index}` : '';
      stack.push({ obj: c === '{', keys: new Set(), want: c === '{', at, index: 0, last: null });
    } else if (c === '}' || c === ']') stack.pop();
    else if (c === ',') { const top = stack[stack.length - 1]; if (top) { if (top.obj) top.want = true; else top.index++; } }
    i++;
  }
  return null;
}

function readStrict(file) {
  let bytes;
  try { bytes = fs.readFileSync(file); } catch { return { missing: true }; }
  const text = bytes.toString('utf8');
  let value;
  try { value = JSON.parse(text); } catch (e) { return { ok: false, bytes, error: e.message }; }
  return { ok: true, bytes, value, dup: duplicateKey(text) };
}

function git(cwd, args, { buffer = false } = {}) {
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_NAMESPACE']) delete env[k];
  const r = spawnSync('git', args, { cwd, env, encoding: buffer ? 'buffer' : 'utf8', maxBuffer: 256 << 20 });
  return { ok: r.status === 0, out: buffer ? r.stdout : String(r.stdout || '').trim() };
}
const isRepo = (root) => git(root, ['rev-parse', '--is-inside-work-tree']).out === 'true';
const commitOf = (root, rev) => { const r = git(root, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]); return r.ok ? r.out : null; };
const isAncestor = (root, a, b) => git(root, ['merge-base', '--is-ancestor', a, b]).ok;
const blobAt = (root, commit, p) => { const r = git(root, ['cat-file', 'blob', `${commit}:./${p}`], { buffer: true }); return r.ok ? r.out : null; };
const isSha = (s) => typeof s === 'string' && /^[0-9a-f]{7,64}$/.test(s);

/** The commit that last added `p` (git log --diff-filter=A), or null. */
export function addedIn(root, p) {
  const r = git(root, ['log', '--diff-filter=A', '--format=%H', '--', p]);
  return r.ok && r.out ? r.out.split('\n')[0] : null;
}

function normPath(p) {
  if (typeof p !== 'string') return null;
  let s = p.replace(/\\/g, '/');
  while (s.startsWith('./')) s = s.slice(2);
  if (!s || s.startsWith('/') || s.split('/').includes('..')) return null;
  return s;
}

/** The tasks as contractDraft drafts them (makeTask with the same defaults). Throws on a task makeTask refuses. */
export function draftTasks(spec) {
  return arr(spec?.tasks).map((t, i) => makeTask({ id: t.id || `T${i + 1}`, title: t.title, phase: t.phase || 'implement', depends_on: t.depends_on || [], requirements: t.requirements || [], description: t.description || '', scope: t.scope || ['**'], criteria: t.criteria || [], stop_rules: t.stop_rules || [] }));
}

const scopeOf = (t) => (Array.isArray(t?.scope) ? t.scope : Array.isArray(t?.scope?.allow) ? t.scope.allow : t?.scope === undefined ? ['**'] : [String(t.scope)]);
const taskMap = (spec) => new Map(arr(spec?.tasks).map((t, i) => [t?.id || `T${i + 1}`, t || {}]));

/** The part of a round its own signature covers: everything but what the builder writes afterwards. */
export function reviewerPart(round) {
  const o = omit(round, ROUND_BUILDER);
  if (Array.isArray(round.answers)) o.answers = round.answers.map((a) => (isObj(a) ? omit(a, ANSWER_BUILDER) : a));
  return o;
}

/** What the builder wrote on a round: each answer's disposition, reason and folded_as, the amendments and folded. */
export function builderPart(round) {
  return { round: round.round, answers: arr(round.answers).map((a) => (isObj(a) ? pick(a, ['n', ...ANSWER_BUILDER]) : a)), amendments: arr(round.amendments), ...(round.folded !== undefined ? { folded: round.folded } : {}) };
}

/** What round i's sig signs: canonical({...round without builder fields, snapshot_sha256, previous round in full}). */
export function roundPayload(rounds, i, snapshotSha) {
  return { ...reviewerPart(rounds[i]), snapshot_sha256: snapshotSha ?? null, previous: i > 0 ? rounds[i - 1] : null };
}

/** What a closing envelope signs: the spec id, the round number and that round's dispositions and amendments. */
export const closingPayload = (specId, round) => ({ spec_id: specId, round: round.round, dispositions: builderPart(round) });

/** sha256 of canonical(every round's dispositions and amendments), as a stop decision records it. */
export const dispositionsSha256 = (rounds) => sha256(canonical(rounds.map(builderPart)));

const hasBuilderContent = (r) => arr(r.answers).length > 0 || arr(r.amendments).length > 0 || r.folded !== undefined;

function trustedKeys(list) {
  const m = new Map();
  for (const pem of arr(list)) { try { m.set(keyId(pem), pem); } catch { /* not a usable public key: trusts nothing */ } }
  return m;
}

function contractKeys(root) {
  const dir = path.join(root, 'contracts', 'keys');
  const m = new Map();
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return m; }
  for (const n of names) {
    if (!n.endsWith('.pub')) continue;
    try { const pem = fs.readFileSync(path.join(dir, n), 'utf8'); m.set(keyId(pem), { pem, file: n }); } catch { /* unreadable */ }
    if (/^[0-9a-f]{16}\.pub$/.test(n) && !m.has(n.slice(0, 16))) m.set(n.slice(0, 16), { pem: null, file: n });
  }
  return m;
}

/** null when `env` is a DSSE envelope over `obj` by one of `trusted` and by no key in `refused`, else why not. */
function envelopeProblem(obj, env, trusted, refused) {
  if (!isObj(env)) return 'is not signed';
  if (env.payloadType !== PAYLOAD_TYPE || typeof env.payload !== 'string') return 'is not a DSSE envelope of the expected payload type';
  const sigs = env.signatures;
  if (!Array.isArray(sigs) || sigs.length !== 1 || !isObj(sigs[0])) return 'must carry exactly one signature';
  const kid = sigs[0].keyid;
  if (typeof kid !== 'string' || !/^[0-9a-f]{16}$/.test(kid)) return 'names no valid key id';
  if (refused.has(kid)) return `is signed by ${kid}, a contract-signing key under contracts/keys/, not a reviewer key`;
  const pem = trusted.get(kid);
  if (!pem) return `is signed by ${kid}, which is not a reviewer key the gate accepts`;
  if (Buffer.from(env.payload, 'base64').toString('utf8') !== canonicalHash(obj)) return 'covers other content: something it signs was changed after signing';
  return dsseVerify(obj, env, pem).ok ? null : `does not verify against reviewer key ${kid}`;
}

/** The text of numbered point `p` ("1. ... 2. ...") of a round's notes, or null. */
function notePoint(notes, p) {
  if (Array.isArray(notes)) return typeof notes[p - 1] === 'string' ? notes[p - 1] : null;
  if (typeof notes !== 'string') return null;
  const marks = [];
  let want = 1;
  for (const m of notes.matchAll(/(^|\s)(\d+)\.\s/g)) if (Number(m[2]) === want) { marks.push(m.index + m[1].length); want++; }
  if (p < 1 || p > marks.length) return null;
  return notes.slice(marks[p - 1], marks[p] ?? notes.length);
}

const CONTRA = /contradict|impossib/i;

function readsPath(v, p) {
  if (!isObj(v)) return false;
  for (const k of ['test_file', 'file', 'path', 'entry']) if (normPath(v[k]) === p) return true;
  if (arr(v.paths).some((x) => normPath(x) === p)) return true;
  return typeof v.cmd === 'string' && v.cmd.includes(p);
}

/** null when an amendment's citation is acceptable, else why not. kind: cmd (a replacement) or scope. */
function citationProblem(am, prev, kind, task, subject) {
  if (!prev) return 'there is no previous round for it to cite';
  if (am.answer !== undefined) {
    const m = /^(\d+)\.(\d+)$/.exec(String(am.answer));
    if (!m) return `its answer ${am.answer} is not written <round>.<n>`;
    if (Number(m[1]) !== prev.round) return `its answer ${am.answer} is not an answer of the previous round (${prev.round})`;
    const a = arr(prev.answers).find((x) => isObj(x) && x.n === Number(m[2]));
    if (!a) return `round ${prev.round} has no answer ${m[2]}`;
    if (a.criterion?.task !== task) return `answer ${am.answer} concerns task ${a.criterion?.task}, not ${task}`;
    if (kind === 'cmd') {
      if (a.criterion?.statement !== subject) return `answer ${am.answer} proposes a criterion for a different criterion`;
      if (!CONTRA.test(String(a.how ?? ''))) return `answer ${am.answer} does not name the criterion contradictory or impossible`;
    } else {
      if (a.disposition !== 'added') return `answer ${am.answer} is not added`;
      if (!readsPath(a.criterion?.verifier, subject)) return `answer ${am.answer} proposes a criterion that reads no path under ${subject}`;
    }
    return null;
  }
  if (am.note !== undefined && kind === 'cmd') {
    const m = /^(\d+)\.(\d+)$/.exec(String(am.note));
    if (!m) return `its note ${am.note} is not written <round>.<point>`;
    if (Number(m[1]) !== prev.round) return `its note ${am.note} is not a note of the previous round (${prev.round})`;
    const pt = notePoint(prev.notes, Number(m[2]));
    if (pt === null) return `round ${prev.round}'s notes have no point ${m[2]}`;
    if (!CONTRA.test(pt)) return `note ${am.note} does not name anything contradictory or impossible`;
    return null;
  }
  return 'it cites no answer of the previous round';
}

const tighter = (op, before, after) => (op === '>=' || op === '>' ? after >= before : op === '<=' || op === '<' ? after <= before : after === before);

/**
 * How spec B weakens spec A. Accepted only: a command replaced as one entry of `amendments` records
 * ({task, statement, from, to, answer|note} citing the previous round), a scope path added as one records
 * ({task, scope_add, answer}), and a metric value tightened.
 */
export function weakenings(A, B, { amendments = [], prev = null } = {}) {
  const out = [];
  const used = new Set();
  const ams = arr(amendments);
  const tb = taskMap(B);
  for (const [id, ta] of taskMap(A)) {
    const t2 = tb.get(id);
    if (!t2) { out.push(`task ${id} removed`); continue; }
    if ((ta.phase || 'implement') !== (t2.phase || 'implement')) out.push(`task ${id}: phase changed from ${ta.phase || 'implement'} to ${t2.phase || 'implement'}`);
    for (const d of arr(ta.depends_on)) if (!arr(t2.depends_on).includes(d)) out.push(`task ${id}: depends_on entry ${d} removed`);
    for (const q of arr(ta.requirements)) if (!arr(t2.requirements).includes(q)) out.push(`task ${id}: requirement removed or reworded: "${short(q)}"`);
    for (const s of arr(ta.stop_rules)) if (!arr(t2.stop_rules).includes(s)) out.push(`task ${id}: stop rule removed or reworded: "${short(s)}"`);
    const sa = scopeOf(ta);
    for (const g of scopeOf(t2)) {
      if (sa.includes(g)) continue;
      const i = ams.findIndex((a, k) => !used.has(k) && isObj(a) && a.scope_add !== undefined && a.task === id && a.scope_add === g);
      let why = i < 0 ? 'with no scope_add amendment' : null;
      if (!why && /[*?[\]{}]/.test(g)) why = 'a scope_add must name one path, not a glob';
      if (!why) { const c = citationProblem(ams[i], prev, 'scope', id, normPath(g)); if (c) why = `its amendment is refused: ${c}`; }
      if (why) out.push(`task ${id}: scope glob ${g} added ${why}`); else used.add(i);
    }
    // criteria are matched by statement, so reordering is not a removal; equal pairs are matched first
    const pool = new Map();
    for (const cb of arr(t2.criteria)) { const k = String(cb?.statement); if (!pool.has(k)) pool.set(k, []); pool.get(k).push(cb); }
    const pending = [];
    for (const ca of arr(ta.criteria)) {
      const list = pool.get(String(ca?.statement)) || [];
      const j = list.findIndex((cb) => canonical(cb) === canonical(ca));
      if (j >= 0) list.splice(j, 1); else pending.push(ca);
    }
    for (const ca of pending) {
      const where = `task ${id} criterion "${short(ca?.statement)}"`;
      const list = pool.get(String(ca?.statement)) || [];
      const cb = list.shift();
      if (!cb) { out.push(`${where}: removed, or its statement rewritten`); continue; }
      const rest = (c) => omit(c || {}, ['statement', 'verifier', 'mandatory']); // mandatory:false is refused on its own below
      for (const k of new Set([...Object.keys(rest(ca)), ...Object.keys(rest(cb))])) if (canonical(ca[k]) !== canonical(cb[k])) out.push(`${where}: ${k} changed`);
      const va = isObj(ca.verifier) ? ca.verifier : {};
      const vb = isObj(cb.verifier) ? cb.verifier : {};
      if (va.type !== vb.type) { out.push(`${where}: verifier type changed from ${va.type} to ${vb.type}`); continue; }
      for (const k of new Set([...Object.keys(va), ...Object.keys(vb)])) {
        if (canonical(va[k]) === canonical(vb[k])) continue;
        if (k === 'cmd' && typeof va.cmd === 'string' && typeof vb.cmd === 'string') {
          const i = ams.findIndex((a, n) => !used.has(n) && isObj(a) && a.scope_add === undefined && a.task === id && a.statement === ca.statement && a.from === va.cmd && a.to === vb.cmd);
          const why = i < 0 ? 'no amendment records task, statement, from and to for it' : citationProblem(ams[i], prev, 'cmd', id, ca.statement);
          if (why) out.push(`${where}: command changed and ${why}`); else used.add(i);
          continue;
        }
        if (va.type === 'metric' && k === 'value' && va.op === vb.op && typeof va.value === 'number' && typeof vb.value === 'number' && tighter(va.op, va.value, vb.value)) continue;
        out.push(`${where}: verifier ${k} ${va[k] === undefined ? 'added' : vb[k] === undefined ? 'removed' : 'changed'}`);
      }
    }
  }
  return out;
}

/** null when the spec on disk has the added answer's criterion verbatim, else why not. */
function addedProblem(spec, c) {
  if (!isObj(c) || typeof c.task !== 'string' || typeof c.statement !== 'string' || !isObj(c.verifier) || typeof c.verifier.type !== 'string') return 'is added but proposes no criterion (task, statement, verifier)';
  const t = taskMap(spec).get(c.task);
  if (!t) return `is added, but task ${c.task} is not in the spec`;
  const same = arr(t.criteria).filter((x) => isObj(x) && x.statement === c.statement);
  if (!same.length) return `is added, but task ${c.task} of the spec has no criterion "${short(c.statement)}"`;
  const typed = same.filter((x) => x.verifier?.type === c.verifier.type);
  if (!typed.length) return `is added, but the spec's criterion "${short(c.statement)}" has another verifier type`;
  const equal = typed.filter((x) => canonical(x.verifier) === canonical(c.verifier));
  if (!equal.length) return `is added, but the spec's verifier for "${short(c.statement)}" is not the one proposed`;
  if (!equal.some((x) => Object.keys(x).every((k) => CRITERION_KEYS.includes(k)) && (x.mandatory === undefined || x.mandatory === true))) return `is added, but the spec's criterion "${short(c.statement)}" carries mandatory:false or a key other than ${CRITERION_KEYS.join(', ')}`;
  return null;
}

const runsOwnTest = (v) => typeof v?.cmd === 'string' && typeof v?.test_file === 'string' && (v.cmd.includes('{test}') || v.cmd.includes(normPath(v.test_file) ?? v.test_file));

function manifestKind(file, id) {
  try { const row = arr(JSON.parse(fs.readFileSync(file, 'utf8')).contracts).find((r) => r?.id === id); return row ? (row.kind ?? 'feature') : null; } catch { return null; }
}

/** The highest round count any committed version of the record held, with the commit. */
function recordHistory(root, recRel) {
  const log = git(root, ['log', '--format=%H', '--', recRel]);
  let best = { max: 0, commit: null };
  if (!log.ok || !log.out) return best;
  for (const c of log.out.split('\n')) {
    const shown = git(root, ['show', `${c}:./${recRel}`]);
    if (!shown.ok) continue;
    try { const n = arr(JSON.parse(shown.out).rounds).length; if (n > best.max) best = { max: n, commit: c }; } catch { /* not JSON then */ }
  }
  return best;
}

/** In-scope files that differ between two commits, leaving out the red-team record and signing files. */
export function inScopeChanges({ cwd, spec, from, to, exclude = [] }) {
  const root = path.resolve(cwd);
  const d = git(root, ['diff', '--name-only', '--no-renames', '--relative', from, to]);
  if (!d.ok) return null;
  const globs = arr(spec?.tasks).flatMap(scopeOf);
  const skip = (f) => f.startsWith('contracts/signed/') || f.startsWith('contracts/keys/') || exclude.some((e) => (e.endsWith('/') ? f.startsWith(e) : f === e));
  const files = d.out ? d.out.split('\n').filter((f) => !skip(f)) : [];
  return { inScope: files.filter((f) => matchAny(f, globs)), outside: files.filter((f) => !matchAny(f, globs)) };
}

/**
 * Judge one spec. spec: its path (relative to cwd or absolute). reviewerKeys: the reviewer public keys
 * (PEM) to accept instead of REVIEWER_KEYS. at: the commit staleness is judged at (default HEAD; the
 * signing commit for a signed contract). Returns { status, reasons, codes, ... }; status is SIGNABLE,
 * SIGNABLE AT STOP, NOT SIGNABLE or NO RECORD, and reasons is empty unless NOT SIGNABLE.
 */
export function evaluate({ spec, cwd = process.cwd(), reviewerKeys, at } = {}) {
  const root = path.resolve(cwd);
  const specAbs = path.resolve(root, String(spec));
  const rel = (p) => posix(path.relative(root, p));
  const id = specIdOf(specAbs);
  const loc = locate(specAbs, id);
  const out = { status: null, reasons: [], codes: [], spec: rel(specAbs), spec_id: id, spec_sha256: null, record: rel(loc.record), signable_sha256: null, claimed_clean: false, reported: [], open: [], stop: null, implementation: null };
  const fail = (code, detail) => { out.reasons.push(`${code}: ${detail}`); if (!out.codes.includes(code)) out.codes.push(code); };
  const finish = () => {
    out.status = out.codes.length ? 'NOT SIGNABLE' : out.stop ? 'SIGNABLE AT STOP' : 'SIGNABLE';
    if (out.codes.length) out.open = [];
    return out;
  };

  const sr = readStrict(specAbs);
  if (sr.missing) { fail('schema', `the spec ${out.spec} does not exist`); return finish(); }
  if (!sr.ok) { fail('schema', `the spec is not JSON (${sr.error})`); return finish(); }
  if (sr.dup) fail('schema', `the spec holds the key ${sr.dup} twice`);
  const disk = sr.value;
  if (!isObj(disk) || !Array.isArray(disk.tasks)) { fail('schema', 'the spec has no tasks list'); return finish(); }
  out.spec_sha256 = specSha256(disk);

  const rr = readStrict(loc.record);
  if (rr.missing) { out.status = 'NO RECORD'; return out; }
  if (!rr.ok) { fail('schema', `the record ${out.record} is not JSON (${rr.error})`); return finish(); }
  if (rr.dup) fail('schema', `the record holds the key ${rr.dup} twice`);
  const rec = rr.value;
  if (!isObj(rec)) { fail('schema', 'the record is not an object'); return finish(); }
  if (rec.schema !== SCHEMA) { fail('schema', `the record's schema is ${JSON.stringify(rec.schema)}, not ${SCHEMA}`); return finish(); }
  if (!Array.isArray(rec.rounds) || !rec.rounds.length || !rec.rounds.every(isObj)) { fail('schema', 'the record has no list of rounds'); return finish(); }
  const rounds = rec.rounds;

  // schema: the rest of the shape; each problem is named and the checks go on
  rounds.forEach((r, i) => {
    const at_ = `round ${i + 1}`;
    if (!Number.isInteger(r.round)) fail('schema', `${at_} has no integer round number`);
    if (r.kind !== undefined && r.kind !== 'spec' && r.kind !== 'implementation') fail('schema', `${at_} has kind ${JSON.stringify(r.kind)}`);
    if (typeof r.spec_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(r.spec_sha256)) fail('schema', `${at_} has no spec_sha256`);
    if (r.verdict !== 'clean' && r.verdict !== 'findings') fail('schema', `${at_} has verdict ${JSON.stringify(r.verdict)}, not clean or findings`);
    if (!Array.isArray(r.answers)) fail('schema', `${at_} has no answers list`);
    const seen = new Set();
    for (const a of arr(r.answers)) {
      if (!isObj(a) || !Number.isInteger(a.n)) { fail('schema', `${at_} has an answer without an integer n`); continue; }
      if (seen.has(a.n)) fail('schema', `${at_} numbers two answers ${a.n}`);
      seen.add(a.n);
      if (!SEVERITIES.includes(a.severity)) fail('schema', `${at_} answer ${a.n} has severity ${JSON.stringify(a.severity)}`);
    }
    if (r.amendments !== undefined && !(Array.isArray(r.amendments) && r.amendments.every(isObj))) fail('schema', `${at_} has amendments that are not a list of entries`);
    if (r.inputs !== undefined && !(isObj(r.inputs) && (r.inputs.files === undefined || (Array.isArray(r.inputs.files) && r.inputs.files.every((f) => isObj(f) && typeof f.path === 'string' && typeof f.sha256 === 'string'))))) fail('schema', `${at_} has inputs.files that are not a list of {path, sha256}`);
  });
  if (rec.stop !== undefined && !isObj(rec.stop)) fail('schema', 'the stop decision is not an object');

  // spec_id
  if (rec.spec_id !== id) fail('spec_id', `the record is for ${JSON.stringify(rec.spec_id)}, the spec is ${id}`);
  if (rec.spec_file !== undefined && normPath(rec.spec_file) !== out.spec) fail('spec_id', `the record names the spec file ${rec.spec_file}, not ${out.spec}`);

  // rounds_contiguous
  rounds.forEach((r, i) => { if (r.round !== i + 1) fail('rounds_contiguous', `the round at position ${i + 1} is numbered ${r.round}`); });
  let names = [];
  try { names = fs.readdirSync(loc.redteam); } catch { /* no directory */ }
  for (const f of names.sort()) {
    const m = /^(.+)\.r(\d+)\.spec\.json$/.exec(f);
    if (m && m[1] === id && (Number(m[2]) > rounds.length || Number(m[2]) < 1)) fail('rounds_contiguous', `the snapshot ${f} has no round in a record of ${rounds.length}`);
  }
  const repo = isRepo(root);
  if (repo) {
    const h = recordHistory(root, out.record);
    if (h.max > rounds.length) fail('rounds_contiguous', `an earlier committed version of the record (${h.commit.slice(0, 12)}) held ${h.max} rounds; this one holds ${rounds.length}`);
  }

  let lastIdx = -1;
  rounds.forEach((r, i) => { if (r.kind !== 'implementation') lastIdx = i; });
  if (lastIdx < 0) { fail('last_clean', 'the record holds no spec round'); return finish(); }
  const judged = rounds.slice(0, lastIdx + 1);
  const specRounds = judged.filter((r) => r.kind !== 'implementation');
  const last = rounds[lastIdx];
  const stop = isObj(rec.stop) ? rec.stop : null;

  // hash: every spec round's snapshot is present and is what the round names
  const snaps = rounds.map((r, i) => {
    const s = readStrict(loc.snapshot(i + 1));
    return s.missing ? null : { ...s, sha: sha256(s.bytes) };
  });
  const snapOf = new Map();
  judged.forEach((r, i) => {
    if (r.kind === 'implementation') return;
    const s = snaps[i];
    const label = `round ${i + 1}`;
    if (!s) { fail('hash', `${label}: the snapshot ${path.basename(loc.snapshot(i + 1))} is missing`); return; }
    if (!s.ok) { fail('schema', `${label}: the snapshot is not JSON (${s.error})`); return; }
    if (s.dup) fail('schema', `${label}: the snapshot holds the key ${s.dup} twice`);
    if (!isObj(s.value)) { fail('schema', `${label}: the snapshot is not an object`); return; }
    if (specSha256(s.value) !== r.spec_sha256) fail('hash', `${label}: the snapshot's hash ${specSha256(s.value).slice(0, 12)} is not the round's spec_sha256 ${String(r.spec_sha256).slice(0, 12)}`);
    snapOf.set(r, s.value);
  });

  // review_sig: each round is signed by a reviewer key over its answers, its snapshot and the previous round
  const trusted = trustedKeys(reviewerKeys === undefined ? REVIEWER_KEYS : reviewerKeys);
  const ckeys = contractKeys(root);
  const refused = new Set(ckeys.keys());
  judged.forEach((r, i) => {
    const p = envelopeProblem(roundPayload(rounds, i, snaps[i]?.sha), r.sig, trusted, refused);
    if (p) fail('review_sig', `round ${i + 1}'s signature ${p}`);
  });
  if (!stop && hasBuilderContent(last)) {
    const p = envelopeProblem(closingPayload(rec.spec_id, last), last.closing, trusted, refused);
    if (p) fail('review_sig', `round ${last.round}'s dispositions and amendments: the closing envelope ${p}`);
  }

  // dispositions, reasons, added criteria
  for (const r of specRounds) {
    for (const a of arr(r.answers)) {
      if (!isObj(a)) continue;
      const label = `round ${r.round} answer ${a.n}`;
      if (a.disposition !== 'added' && a.disposition !== 'rejected') fail('dispositions_all_rounds', `${label} ${a.disposition === undefined ? 'has no disposition' : `is ${JSON.stringify(a.disposition)}, not added or rejected`}`);
      if (a.disposition === 'rejected' && !(typeof a.reason === 'string' && a.reason.trim())) fail('rejected_reason', `${label} is rejected with no reason`);
      if (a.disposition === 'added') { const p = addedProblem(disk, a.criterion); if (p) fail('added_verbatim', `${label} ${p}`); }
    }
  }

  // the end of the record: a clean last round on the spec on disk, or a stop decision
  out.claimed_clean = last.verdict === 'clean';
  if (!stop) {
    if (last.verdict !== 'clean') fail('last_clean', `the last round (${last.round}) has verdict ${JSON.stringify(last.verdict)}`);
    const highs = arr(last.answers).filter((a) => isObj(a) && a.severity === 'high');
    if (highs.length) fail('last_high', `the last round (${last.round}) holds answers of severity high: ${highs.map((a) => a.n).join(', ')}`);
    if (last.spec_sha256 !== out.spec_sha256) fail('hash', `the last round (${last.round}) reviewed spec ${String(last.spec_sha256).slice(0, 12)}; the spec on disk is ${out.spec_sha256.slice(0, 12)}`);
    out.signable_sha256 = last.spec_sha256;
  } else {
    const problems = [];
    if (specRounds.length < 3) problems.push(`it comes after ${specRounds.length} rounds; a stop needs three`);
    for (const r of specRounds) if (r.verdict === 'clean') problems.push(`round ${r.round} is clean, so the record cannot end with a stop`);
    if (stop.spec_id !== id) problems.push(`it is for ${JSON.stringify(stop.spec_id)}, not ${id}`);
    if (stop.spec_sha256 !== out.spec_sha256) problems.push(`it is over spec ${String(stop.spec_sha256).slice(0, 12)}; the spec on disk is ${out.spec_sha256.slice(0, 12)}`);
    if (typeof stop.decider !== 'string' || !stop.decider.trim()) problems.push('it names no decider');
    if (typeof stop.date !== 'string' || !stop.date.trim()) problems.push('it has no date');
    if (stop.decision !== 'sign' && stop.decision !== 'split') problems.push(`its decision is ${JSON.stringify(stop.decision)}, not sign or split`);
    const want = specRounds.flatMap((r) => arr(r.answers).filter((a) => isObj(a) && a.disposition !== 'added').map((a) => `${r.round}.${a.n}`));
    const open = Array.isArray(stop.open) ? stop.open : null;
    if (!open) problems.push('it has no open list');
    else {
      const have = open.map((o) => `${o?.round}.${o?.n}`);
      for (const w of want) if (!have.includes(w)) problems.push(`its open list leaves out round ${w.split('.')[0]} answer ${w.split('.')[1]}, which is not added`);
      for (const h of have) if (!want.includes(h)) problems.push(`its open list names ${h}, which is not an open answer`);
    }
    if (stop.dispositions !== dispositionsSha256(judged)) problems.push('the dispositions or amendments of the rounds changed after it was signed');
    const env = stop.sig;
    const kid = env?.signatures?.[0]?.keyid;
    const ck = typeof kid === 'string' && /^[0-9a-f]{16}$/.test(kid) ? ckeys.get(kid) : null;
    if (!ck || !ck.pem || ck.file !== `${kid}.pub`) problems.push(`it is not signed by a contract-signing key under contracts/keys/ (${kid ? `key ${kid}` : 'no key'})`);
    else if (!(env.signatures.length === 1 && dsseVerify(omit(stop, ['sig']), env, ck.pem).ok)) problems.push(`its signature by ${kid} does not verify over the decision as it is`);
    for (const p of problems) fail('stop_decision', `the stop decision: ${p}`);
    if (!problems.length) { out.stop = { decision: stop.decision, decider: stop.decider, date: stop.date }; out.open = want.map((w) => ({ round: Number(w.split('.')[0]), n: Number(w.split('.')[1]) })); }
    out.signable_sha256 = stop.spec_sha256;
  }

  // never_weakens: snapshot to snapshot (and on to the disk after a stop), workdir null, no criterion optional
  const chain = specRounds.map((r) => ({ r, s: snapOf.get(r) })).filter((x) => x.s);
  for (let k = 1; k < chain.length; k++) for (const w of weakenings(chain[k - 1].s, chain[k].s, { amendments: chain[k].r.amendments, prev: chain[k - 1].r })) fail('never_weakens', `round ${chain[k].r.round}: ${w}`);
  if (stop && chain.length) for (const w of weakenings(chain[chain.length - 1].s, disk)) fail('never_weakens', `the spec on disk: ${w}`);
  const optional = new Set();
  for (const { label, s } of [...chain.map((x) => ({ label: `round ${x.r.round}`, s: x.s })), { label: 'the spec on disk', s: disk }]) {
    if (s.workdir !== null && s.workdir !== undefined) fail('never_weakens', `${label} sets workdir to ${JSON.stringify(s.workdir)}; it must be null (a workdir belongs on the command line)`);
    for (const [tid, t] of taskMap(s)) for (const c of arr(t.criteria)) {
      if (!isObj(c) || c.mandatory !== false) continue;
      const k = `${tid}\n${c.statement}`;
      if (!optional.has(k)) { optional.add(k); fail('never_weakens', `${label}: task ${tid} criterion "${short(c.statement)}" is mandatory:false`); }
    }
  }

  // red_green_required, on the tasks as contractDraft drafts them
  const kind = manifestKind(loc.manifest, id) ?? 'feature';
  if (last.manifest_kind === undefined) fail('red_green_required', `the last round (${last.round}) records no manifest_kind`);
  else if (last.manifest_kind !== kind) fail('red_green_required', `the last round was reviewed with manifest kind ${JSON.stringify(last.manifest_kind)}; the manifest row now says ${kind}`);
  let drafted = null;
  try { drafted = draftTasks(disk); } catch (e) { fail('schema', `the spec's tasks cannot be drafted (${e.message})`); }
  if (drafted && !EXEMPT_KINDS.includes(kind)) {
    for (const t of drafted) if (t.phase === 'implement' && !t.criteria.some((c) => c.mandatory !== false && c.verifier?.type === 'test_red_green' && runsOwnTest(c.verifier))) fail('red_green_required', `task ${t.id} has no mandatory test_red_green criterion whose cmd runs its own test_file`);
  }

  // head_stale_src: the code the reviewer read is the code at the judged commit
  const label = at ? `the commit ${String(at).slice(0, 12)}` : 'HEAD';
  const globs = arr(disk.tasks).flatMap(scopeOf);
  const files = arr(last.inputs?.files).filter(isObj);
  if (!files.length && globs.some((g) => (normPath(g) ?? '').startsWith('src/') || g.startsWith('**'))) fail('head_stale_src', `the last round (${last.round}) lists no input files although the spec's scope names src/`);
  if (!repo) fail('head_stale_src', 'this is not a git repository, so the reviewed commit and the input files cannot be checked');
  else {
    const target = commitOf(root, at || 'HEAD');
    const stale = new Set();
    if (!target) fail('head_stale_src', `${label} is not a commit in this repository`);
    else {
      const rc = last.base_commit;
      if (!isSha(rc)) fail('head_stale_src', `the last round (${last.round}) names no reviewed commit (base_commit, a commit id)`);
      else if (!commitOf(root, rc)) fail('head_stale_src', `the reviewed commit ${rc.slice(0, 12)} is not in this repository`);
      else if (!isAncestor(root, rc, target)) fail('head_stale_src', `the reviewed commit ${rc.slice(0, 12)} is not an ancestor of ${label}`);
      else {
        const ch = inScopeChanges({ cwd: root, spec: disk, from: rc, to: target, exclude: [`${rel(loc.redteam)}/`, out.spec, rel(loc.manifest)] });
        for (const f of ch?.inScope || []) { stale.add(f); fail('head_stale_src', `${f}, in the spec's scope, changed between the reviewed commit and ${label}`); }
        for (const f of ch?.outside || []) out.reported.push(`${f} changed since the review (outside the scope)`);
      }
      for (const f of files) {
        const p = normPath(f.path);
        if (!p) { fail('schema', `the input path ${JSON.stringify(f.path)} is not a relative path`); continue; }
        const blob = blobAt(root, target, p);
        const now = blob ? sha256(blob) : null;
        if (now === f.sha256) continue;
        const what = now === null ? 'is deleted' : 'changed';
        if (p.startsWith('src/')) { if (!stale.has(p)) fail('head_stale_src', `the input ${p} ${what} at ${label} since the review`); }
        else if (!out.reported.some((x) => x.startsWith(`${p} `))) out.reported.push(`${p} ${what} since the review (an input outside src/)`);
      }
    }
  }

  // an implementation round never changes SIGNABLE; its own verdict is reported for verify
  const implIdx = rounds.map((r, i) => (r.kind === 'implementation' && i > lastIdx ? i : -1)).filter((i) => i >= 0).pop();
  if (implIdx !== undefined) out.implementation = judgeImplementation(rec, rounds, implIdx, snaps, trusted, refused);
  return finish();
}

/** The verdict of implementation round i: signed, every answer dispositioned, clean with no high answer, closed. */
function judgeImplementation(rec, rounds, i, snaps, trusted, refused) {
  const r = rounds[i];
  const reasons = [];
  const sigP = envelopeProblem(roundPayload(rounds, i, snaps[i]?.sha), r.sig, trusted, refused);
  if (sigP) reasons.push(`review_sig: round ${i + 1}'s signature ${sigP}`);
  for (let k = i + 1; k < rounds.length; k++) { const p = envelopeProblem(roundPayload(rounds, k, snaps[k]?.sha), rounds[k].sig, trusted, refused); if (p) reasons.push(`review_sig: round ${k + 1}'s signature ${p}`); }
  if (i === rounds.length - 1 && hasBuilderContent(r)) { const p = envelopeProblem(closingPayload(rec.spec_id, r), r.closing, trusted, refused); if (p) reasons.push(`review_sig: round ${r.round}'s closing envelope ${p}`); }
  if (r.verdict !== 'clean') reasons.push(`last_clean: round ${r.round} has verdict ${JSON.stringify(r.verdict)}`);
  for (const a of arr(r.answers).filter(isObj)) {
    if (a.severity === 'high') reasons.push(`last_high: round ${r.round} answer ${a.n} is of severity high`);
    if (a.disposition !== 'added' && a.disposition !== 'rejected') reasons.push(`dispositions_all_rounds: round ${r.round} answer ${a.n} is not dispositioned`);
    if (a.disposition === 'rejected' && !(typeof a.reason === 'string' && a.reason.trim())) reasons.push(`rejected_reason: round ${r.round} answer ${a.n} has no reason`);
  }
  if (!isSha(r.base_commit)) reasons.push(`head_stale_src: round ${r.round} names no reviewed commit (base_commit)`);
  return { round: r.round, base_commit: r.base_commit ?? null, clean: reasons.length === 0, reasons };
}

/** The spec files the gate reads by default: every .json file in the two spec directories. */
export function defaultSpecs(cwd) {
  const root = path.resolve(cwd);
  const found = [];
  for (const d of DEFAULT_SPEC_DIRS) {
    let names = [];
    try { names = fs.readdirSync(path.join(root, d), { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => e.name).sort(); } catch { /* missing */ }
    for (const n of names) found.push(`${d}/${n}`);
  }
  return found;
}

const statusLine = (r) => {
  if (r.status === 'NOT SIGNABLE') return `${r.spec}: NOT SIGNABLE: ${r.reasons.join('; ')}`;
  if (r.status === 'SIGNABLE AT STOP') return `${r.spec}: SIGNABLE AT STOP (${r.open.length} open items)`;
  const rep = r.reported.length ? ` (reported: ${r.reported.slice(0, 10).join('; ')}${r.reported.length > 10 ? `; and ${r.reported.length - 10} more` : ''})` : '';
  return `${r.spec}: ${r.status}${rep}`;
};

/**
 * The gate run the command line makes. Plain: one line per spec, exit 0 only when every spec is SIGNABLE
 * (or SIGNABLE AT STOP). report: exit 0 unless a record or spec is malformed, a record claims clean on a
 * spec whose hash does not match, or a signed contract under contracts/signed/ is not backed by a
 * SIGNABLE record (grandfathered contracts aside). Returns { exit, lines, errors }.
 */
export function gate({ cwd = process.cwd(), specs = [], report = false, reviewerKeys } = {}) {
  const root = path.resolve(cwd);
  const lines = [];
  const errors = [];
  const named = specs.length > 0;
  for (const s of specs) if (!fs.existsSync(path.resolve(root, s))) errors.push(`no such spec: ${s}`);
  const list = named ? specs.filter((s) => fs.existsSync(path.resolve(root, s))) : defaultSpecs(root);
  if (!named && !list.length) {
    const msg = `no specs found under ${DEFAULT_SPEC_DIRS.map((d) => `${d}/`).join(' or ')}`;
    if (!report) return { exit: 2, lines, errors: [msg] };
    lines.push(msg);
  }
  if (!report) {
    let ok = !errors.length;
    for (const s of list) { const r = evaluate({ spec: s, cwd: root, reviewerKeys }); lines.push(statusLine(r)); if (!r.status.startsWith('SIGNABLE')) ok = false; }
    return { exit: errors.length ? 2 : ok ? 0 : 1, lines, errors };
  }

  // report mode
  const problems = [];
  const pool = [...new Set([...list, ...(named ? defaultSpecs(root) : [])])].map((s) => {
    let obj = null; try { obj = JSON.parse(fs.readFileSync(path.resolve(root, s), 'utf8')); } catch { /* judged below */ }
    let tasks = null; try { tasks = obj ? canonical(draftTasks(obj)) : null; } catch { /* not draftable */ }
    return { s, obj, tasks };
  });
  const signed = [];
  const sdir = path.join(root, 'contracts', 'signed');
  let snames = [];
  try { snames = fs.readdirSync(sdir).filter((n) => n.endsWith('.json') && !n.endsWith('.sig.json')).sort(); } catch { /* none */ }
  for (const n of snames) {
    const relp = `contracts/signed/${n}`;
    let c;
    try { c = JSON.parse(fs.readFileSync(path.join(sdir, n), 'utf8')); } catch { problems.push(`${relp} is not JSON`); continue; }
    if (GRANDFATHERED.includes(canonicalHash(c))) { lines.push(`${relp}: grandfathered (signed before the red-team gate)`); continue; }
    const tasks = (() => { try { return canonical(c.tasks); } catch { return null; } })();
    const linked = pool.filter((p) => p.obj && ((typeof c.title === 'string' && p.obj.title === c.title) || (p.tasks && p.tasks === tasks)));
    signed.push({ n, relp, c, tasks, linked, at: addedIn(root, relp) });
  }
  const signingAt = new Map();
  for (const x of signed) for (const p of x.linked) if (x.at && !signingAt.has(p.s)) signingAt.set(p.s, x.at);

  const counts = { SIGNABLE: 0, 'SIGNABLE AT STOP': 0, 'NOT SIGNABLE': 0, 'NO RECORD': 0 };
  for (const s of list) {
    const r = evaluate({ spec: s, cwd: root, reviewerKeys, at: signingAt.get(s) });
    counts[r.status]++;
    lines.push(statusLine(r));
    if (r.status === 'SIGNABLE AT STOP') for (const o of r.open) lines.push(`  open: round ${o.round} answer ${o.n}`);
    if (r.codes.includes('schema')) problems.push(`${r.spec}: malformed (${r.reasons.filter((x) => x.startsWith('schema:')).join('; ')})`);
    if (r.claimed_clean && r.codes.includes('hash')) problems.push(`${r.spec}: the record's last round claims clean but the hash does not match`);
  }

  for (const x of signed) {
    if (!x.linked.length) { problems.push(`${x.relp} matches no spec by title or drafted tasks and is not grandfathered`); continue; }
    for (const p of x.linked) {
      const where = `${x.relp} (from ${p.s})`;
      if (p.tasks !== x.tasks) problems.push(`${where}: its tasks are not the tasks drafted from the spec`);
      const r = evaluate({ spec: p.s, cwd: root, reviewerKeys, at: x.at || undefined });
      if (!r.status.startsWith('SIGNABLE')) { problems.push(`${where}: the spec is ${r.status}${r.reasons.length ? `: ${r.reasons.join('; ')}` : ''}`); continue; }
      // the signature, the provenance hash and the order of commits
      let env = null;
      try { env = JSON.parse(fs.readFileSync(path.join(sdir, x.n.replace(/\.json$/, '.sig.json')), 'utf8')); } catch { /* missing */ }
      const kid = env?.signatures?.[0]?.keyid;
      let pub = null;
      if (typeof kid === 'string' && /^[0-9a-f]{16}$/.test(kid)) { try { pub = fs.readFileSync(path.join(root, 'contracts', 'keys', `${kid}.pub`), 'utf8'); } catch { /* missing */ } }
      if (!env) problems.push(`${where}: its signature file is missing`);
      else if (!pub || !dsseVerify(x.c, env, pub).ok) problems.push(`${where}: its signature does not verify against contracts/keys/${kid}.pub`);
      if (x.c.provenance?.spec_sha256 !== r.signable_sha256) problems.push(`${where}: provenance.spec_sha256 ${x.c.provenance?.spec_sha256 === undefined ? 'is missing' : 'is not the hash the record makes signable'}`);
      if (!x.at) problems.push(`${where}: it is not committed`);
      else {
        const cleanAt = cleanCommit(root, r);
        if (!cleanAt) problems.push(`${where}: the record's clean round (or stop decision) is not committed`);
        else if (!isAncestor(root, cleanAt, x.at)) problems.push(`${where}: it was committed before the record's clean round (or stop decision)`);
      }
    }
  }
  for (const p of problems) lines.push(`FAIL: ${p}`);
  lines.push(`examined ${list.length} specs (${counts.SIGNABLE} SIGNABLE, ${counts['SIGNABLE AT STOP']} SIGNABLE AT STOP, ${counts['NOT SIGNABLE']} NOT SIGNABLE, ${counts['NO RECORD']} NO RECORD) and ${snames.length} signed contracts`);
  return { exit: errors.length ? 2 : problems.length ? 1 : 0, lines, errors };
}

/** The oldest commit whose version of the record already makes this spec signable (clean round or stop). */
function cleanCommit(root, r) {
  const log = git(root, ['log', '--reverse', '--format=%H', '--', r.record]);
  if (!log.ok || !log.out) return null;
  for (const c of log.out.split('\n')) {
    const shown = git(root, ['show', `${c}:./${r.record}`]);
    if (!shown.ok) continue;
    let rec; try { rec = JSON.parse(shown.out); } catch { continue; }
    if (r.stop) { if (rec?.stop?.spec_sha256 === r.signable_sha256) return c; continue; }
    if (arr(rec?.rounds).some((x) => x?.verdict === 'clean' && x?.spec_sha256 === r.signable_sha256 && x?.kind !== 'implementation')) return c;
  }
  return null;
}
