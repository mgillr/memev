// SPDX-License-Identifier: Apache-2.0
// The mutation gate breaks each line a change added or edited, one mutant at a time, and fails when the tests still pass.
// Before judging, the unmutated tests run twice, then once with every changed line rewritten to the same meaning; each
// mutant is judged on two runs, each in its own copy of the repository; the unmutated tests run once more before a kill is
// accepted. A failing control stops the run as noise. A changed line that carries code but that no judged mutant covers
// leaves the change unjudged, and the run is not ok. A copy's history ends at the base, so the change is uncommitted work
// in it, and its tests run with no remote, no credential helper and refusing stubs for the service managers.
// scripts/gate/mutate.mjs is the command line over this module.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

export const GATE_VERSION = 1;
export const MUTATION_DIRS = ['src', 'vendor', 'bin'];
export const MUTATION_EXTS = ['.mjs', '.js', '.cjs'];
export const EXIT = { pass: 0, survived: 1, noise: 2, error: 2, 'no-mutants': 3 };
const RUN_PREFIX = 'memev-mutate-';
const CONTROL_LIMIT_MS = 30 * 60 * 1000;
const CHECK_LIMIT_MS = 60 * 1000;
// How long a finished test command's output pipes may stay open, held by a process that left its group, before the run
// stops waiting for them.
const PIPE_GRACE_MS = 2000;
// Variables that point git at another repository, index or config file. Neither the gate's own git calls nor a test
// command see them, so each reaches only the repository it runs in.
const GIT_REDIRECT = ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_CONFIG', 'GIT_CONFIG_GLOBAL'];
// Variables that let git or ssh authenticate to a remote. No command the gate runs sees them.
const REMOTE_REACH = ['SSH_AUTH_SOCK', 'SSH_AGENT_PID', 'GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_ASKPASS', 'SSH_ASKPASS'];
// Configuration a copy never takes from the caller's repository: its format and worktree settings (the copy has its own),
// and every setting that names a remote, rewrites a URL, carries a credential or an HTTP header, or runs a daemon.
const SKIP_CONFIG = /^(core\.(repositoryformatversion|bare|worktree|fsmonitor|sshcommand)$|extensions\.|remote\.|branch\.|url\.|include\.|includeif\.|submodule\.|credential\.|http\.)/;
// Service managers and the tunnel client: every test command finds the gate's refusing stub first on its PATH.
export const STUBBED = ['launchctl', 'systemctl', 'schtasks', 'cloudflared'];
const COPY = { recursive: true, verbatimSymlinks: true, mode: fs.constants.COPYFILE_FICLONE };

export const USAGE = `Usage: node scripts/gate/mutate.mjs --base <sha> --test <cmd> [--scope <glob>]... [--json]
  Mutates the lines added or changed since <sha> in .mjs, .js and .cjs files under src/, vendor/ and bin/, one mutant at a
  time, and runs <cmd> on each. Exit 0 when every judged mutant is killed and every changed line that carries code was
  judged, 1 when one survives, 2 on noise, an error or a changed line left unjudged, 3 when no mutant could be judged.
  A line with the comment "mutate-ignore: <reason>" is skipped.
`;

// ---------------------------------------------------------------------------------------------------------------------
// A small JavaScript tokenizer: enough to tell code from strings, comments, templates and regular expressions, so a
// mutation never lands inside a literal and never splits a longer operator (the > of =>, the == of ===).

const PUNCT = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||',
  '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>'];
const KEYWORDS = new Set(['break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum',
  'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'return', 'static', 'switch',
  'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'await', 'this', 'super', 'null', 'true', 'false']);
const VALUES = new Set(['this', 'super', 'null', 'true', 'false']);
const NUMBER = /0[xX][\da-fA-F_]+n?|0[bB][01_]+n?|0[oO][0-7_]+n?|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?n?/y;
const ESCAPE = /\\u(?:[\da-fA-F]{4}|\{[\da-fA-F]+\})/y;
const ID_START = /[\p{ID_Start}$_]/u;
const ID_PART = /[\p{ID_Continue}$\u200c\u200d]/u;
const SPACE = /[\s\ufeff]/;
// The ) that closes one of these headers ends a statement head, not an operand, so a / after it starts a regular expression.
const HEADS = new Set(['if', 'while', 'for', 'with']);

function endsOperand(list, k = list.length - 1) {
  const p = list[k];
  if (!p) return false;
  if (p.t === 'id' || p.t === 'num' || p.t === 'str' || p.t === 'tpl' || p.t === 're') return true;
  if (p.t === 'kw') return VALUES.has(p.v);
  if (p.v === ')' || p.v === ']') return true;
  return (p.v === '++' || p.v === '--') && endsOperand(list, k - 1); // a postfix ++ ends an operand
}

export function tokenize(src) {
  const n = src.length;
  const comments = [];
  const fail = (what, at) => { throw new Error(`${what} at offset ${at}`); };
  const idChar = (k, re) => { const cp = src.codePointAt(k); return cp !== undefined && re.test(String.fromCodePoint(cp)); };
  const readId = (k) => {
    if (src[k] === '#') k++;
    while (k < n) {
      if (src[k] === '\\') { ESCAPE.lastIndex = k; const m = ESCAPE.exec(src); if (!m) fail('bad escape in a name', k); k += m[0].length; continue; }
      if (!idChar(k, ID_PART)) break;
      k += String.fromCodePoint(src.codePointAt(k)).length;
    }
    return k;
  };
  const readStr = (k) => {
    const q = src[k++];
    while (k < n) {
      const c = src[k];
      if (c === '\\') { k += src[k + 1] === '\r' && src[k + 2] === '\n' ? 3 : 2; continue; }
      if (c === q) return k + 1;
      if (c === '\n') break;
      k++;
    }
    return fail('unterminated string', k);
  };
  const readRegex = (k) => {
    let j = k + 1, cls = false;
    while (j < n) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '\n') break;
      if (cls) { if (c === ']') cls = false; } else if (c === '[') cls = true;
      else if (c === '/') { j++; while (j < n && idChar(j, ID_PART)) j++; return j; }
      j++;
    }
    return fail('unterminated regular expression', k);
  };
  const readTpl = (k) => {
    k++;
    while (k < n) {
      const c = src[k];
      if (c === '\\') { k += 2; continue; }
      if (c === '`') return k + 1;
      if (c === '$' && src[k + 1] === '{') { k = scan(k + 2, [], true); continue; }
      k++;
    }
    return fail('unterminated template', k);
  };
  // scan pushes tokens onto out; inside a template's ${ } it returns just past the closing brace.
  function scan(k, out, inBrace) {
    let depth = 0, nl = false;
    const heads = [];
    while (k < n) {
      const c = src[k];
      if (c === '\n' || c === '\u2028' || c === '\u2029') { nl = true; k++; continue; }
      if (SPACE.test(c)) { k++; continue; }
      if (c === '/' && src[k + 1] === '/') {
        let e = src.indexOf('\n', k); if (e < 0) e = n;
        comments.push({ s: k, e, text: src.slice(k + 2, e) }); k = e; continue;
      }
      if (c === '/' && src[k + 1] === '*') {
        const e = src.indexOf('*/', k + 2); if (e < 0) fail('unterminated comment', k);
        if (src.slice(k, e).includes('\n')) nl = true;
        comments.push({ s: k, e: e + 2, text: src.slice(k + 2, e) }); k = e + 2; continue;
      }
      const s = k;
      let t, hdr = false;
      if (c === '"' || c === "'") { k = readStr(k); t = 'str'; }
      else if (c === '`') { k = readTpl(k); t = 'tpl'; }
      else if ((c >= '0' && c <= '9') || (c === '.' && src[k + 1] >= '0' && src[k + 1] <= '9')) {
        NUMBER.lastIndex = k; const m = NUMBER.exec(src); k += m ? m[0].length : 1; t = 'num';
      } else if (c === '#' || c === '\\' || idChar(k, ID_START)) { k = readId(k); t = KEYWORDS.has(src.slice(s, k)) ? 'kw' : 'id'; }
      else if (c === '/' && (!endsOperand(out) || out.at(-1).hdr)) { k = readRegex(k); t = 're'; }
      else {
        let v = PUNCT.find((p) => src.startsWith(p, k)) || c;
        if (v === '?.' && /\d/.test(src[k + 2] || '')) v = '?';
        k += v.length; t = 'p';
        if (v === '(') heads.push(out.at(-1)?.t === 'kw' && HEADS.has(out.at(-1).v));
        else if (v === ')') hdr = heads.pop() === true;
        if (v === '{') depth++;
        else if (v === '}') { if (inBrace && depth === 0) return k; depth--; }
      }
      const tok = { t, v: src.slice(s, k), s, e: k, nl };
      if (hdr) tok.hdr = true;
      out.push(tok);
      nl = false;
    }
    if (inBrace) fail('unterminated template expression', k);
    return k;
  }
  const toks = [];
  scan(src.startsWith('#!') ? src.indexOf('\n') + 1 || n : 0, toks, false);
  const starts = [0];
  for (let k = 0; k < n; k++) if (src[k] === '\n') starts.push(k + 1);
  const lineOf = (off) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
  for (const t of toks) { t.line = lineOf(t.s); t.last = lineOf(t.e - 1); }
  for (const c of comments) c.line = lineOf(c.s);
  return { toks, comments, lineOf };
}

// ---------------------------------------------------------------------------------------------------------------------
// Mutation sites. Each site is a line, an operator name and the edits that make the mutant.

const SWAP = { '===': '!==', '!==': '===', '==': '!=', '!=': '==', '<': '>=', '>=': '<', '>': '<=', '<=': '>', '&&': '||', '||': '&&',
  '??': '||', '||=': '&&=', '&&=': '||=', '+=': '-=', '-=': '+=', '*': '/', '/': '*', '%': '*', '++': '--', '--': '++' };
const BINARY_ONLY = new Set(['*', '/', '%', '<', '>', '<=', '>=']);
const PREFIX_KW = new Set(['typeof', 'void', 'delete', 'await', 'new']);
const PREFIX_P = new Set(['!', '~', '+', '-', '++', '--']);
// After these a new operand starts, so a single operand there can be wrapped in parentheses without changing the meaning.
const OPERAND_AFTER = new Set(['===', '!==', '==', '!=', '<', '>', '<=', '>=', '&&', '||', '??', '+', '-', '*', '/', '%', '**', '&', '|',
  '^', '<<', '>>', '>>>', '!', '~', '?', '=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^=', '&&=', '||=', '??=']);
const STATEMENT_NAME_NEXT = new Set(['.', '?.', '(', '[', '++', '--', '=', '+=', '-=', '*=', '/=', '%=', '||=', '&&=', '??=']);
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^=', '&&=', '||=', '??=']);
const DECLARE = new Set(['const', 'let', 'var']);
// Tokens that never by themselves make a line carry code a test could check.
const STRUCTURE = new Set(['{', '}', '(', ')', '[', ']', ',', ';', ':', '.', '?.', '=>', '...']);
const BEHAVIOUR_KW = new Set(['return', 'throw', 'await', 'yield', 'delete', 'new', 'in', 'instanceof']);
const newlines = (text) => text.replace(/[^\n]/g, '');

export function analyse(src) {
  const { toks, comments, lineOf } = tokenize(src);
  const N = toks.length;
  const match = new Array(N);
  const stack = [];
  for (let k = 0; k < N; k++) {
    const t = toks[k];
    if (t.t !== 'p') continue;
    if (t.v === '(' || t.v === '[' || t.v === '{') stack.push(k);
    else if (t.v === ')' || t.v === ']' || t.v === '}') { const o = stack.pop(); if (o !== undefined) { match[o] = k; match[k] = o; } }
  }
  const P = (k, v) => toks[k] !== undefined && toks[k].t === 'p' && toks[k].v === v;
  const K = (k, v) => toks[k] !== undefined && toks[k].t === 'kw' && toks[k].v === v;
  const operandEnd = (k) => endsOperand(toks, k);

  // One operand: prefix operators, a primary and its member, call and index chain. null when the tokens at k are not one.
  function chainAt(k, prefix = false) {
    if (prefix) while (toks[k] && ((toks[k].t === 'p' && PREFIX_P.has(toks[k].v)) || (toks[k].t === 'kw' && PREFIX_KW.has(toks[k].v)))) k++;
    const t = toks[k];
    if (!t) return null;
    if (t.t === 'id') {
      if (t.v === 'async' && toks[k + 1] && (toks[k + 1].t === 'id' || K(k + 1, 'function'))) return null;
      k++;
    } else if (t.t === 'num' || t.t === 'str' || t.t === 'tpl' || t.t === 're' || (t.t === 'kw' && VALUES.has(t.v))) k++;
    else if (K(k, 'import') && (P(k + 1, '.') || P(k + 1, '('))) k++;
    else if (P(k, '(') || P(k, '[') || P(k, '{')) { if (match[k] === undefined) return null; k = match[k] + 1; }
    else return null;
    let call = false;
    for (;;) {
      const p = toks[k];
      if (!p) break;
      if ((P(k, '.') || P(k, '?.')) && toks[k + 1] && (toks[k + 1].t === 'id' || toks[k + 1].t === 'kw')) { k += 2; call = false; continue; }
      if (P(k, '?.') && (P(k + 1, '(') || P(k + 1, '['))) { if (match[k + 1] === undefined) return null; call = P(k + 1, '('); k = match[k + 1] + 1; continue; }
      if (P(k, '[') || P(k, '(')) { if (match[k] === undefined) return null; call = P(k, '('); k = match[k] + 1; continue; }
      if (p.t === 'tpl') { k++; call = false; continue; }
      if ((P(k, '++') || P(k, '--')) && !p.nl) { k++; call = false; continue; }
      break;
    }
    if (P(k, '=>')) return null;
    return { end: k - 1, call };
  }

  // Whether a token after a line break starts a new statement (automatic semicolon insertion) rather than continuing.
  const startsStatement = (t) => t.t === 'id' || t.t === 'num' || t.t === 'str' || (t.t === 'kw' && !['in', 'instanceof'].includes(t.v)) ||
    (t.t === 'p' && ['{', '++', '--', '!', '~'].includes(t.v));
  // The last token of the expression that starts at k: it stops at ; , ) ] } (unmatched), a : with no ? of its own, or a
  // line break where a semicolon would be inserted.
  function exprEnd(k, comma) {
    let last = -1, q = 0;
    for (let j = k; j < N;) {
      const t = toks[j];
      if (j > k && t.nl && operandEnd(j - 1) && startsStatement(t)) break;
      if (t.t === 'p') {
        if (t.v === ';' || t.v === ')' || t.v === ']' || t.v === '}' || (t.v === ',' && !comma)) break;
        if (t.v === '?') q++;
        if (t.v === ':') { if (q === 0) break; q--; }
        if (t.v === '(' || t.v === '[' || t.v === '{') { if (match[j] === undefined) return -1; last = match[j]; j = match[j] + 1; continue; }
      }
      last = j; j++;
    }
    return last;
  }
  function caseColon(k) {
    for (let j = k - 1; j >= 0; j--) {
      const t = toks[j];
      if (t.t === 'kw' && (t.v === 'case' || t.v === 'default')) return true;
      if (t.t === 'p' && (t.v === ';' || t.v === '{' || t.v === '}' || t.v === '?' || t.v === ',')) return false;
      if (t.t === 'p' && (t.v === ')' || t.v === ']') && match[j] !== undefined) j = match[j];
    }
    return false;
  }
  function headerParen(k) { const o = match[k]; return o !== undefined && ['if', 'for', 'while', 'with'].some((w) => K(o - 1, w)); }
  function stmtStart(k) {
    if (k === 0) return true;
    const p = toks[k - 1];
    if (p.t === 'p' && (p.v === ';' || p.v === '{' || p.v === '}')) return true;
    if (p.t === 'kw' && (p.v === 'else' || p.v === 'do')) return true;
    if (P(k - 1, ')')) return headerParen(k - 1);
    if (P(k - 1, ':')) return caseColon(k - 1);
    return toks[k].nl && operandEnd(k - 1);
  }
  function isFunctionValue(k) {
    if (K(k, 'function') || K(k, 'class')) return true;
    if (toks[k]?.t === 'id' && toks[k].v === 'async' && (K(k + 1, 'function') || toks[k + 1]?.t === 'id' || P(k + 1, '('))) return true;
    if (toks[k]?.t === 'id' && P(k + 1, '=>')) return true;
    return P(k, '(') && match[k] !== undefined && P(match[k] + 1, '=>');
  }
  const span = (a, b, text) => ({ s: toks[a].s, e: toks[b].e, text: text + newlines(src.slice(toks[a].s, toks[b].e)) });
  // Removes the statement from token a to token b; a ; is left in its place so an if or else keeps a body.
  const removal = (a, b) => (P(b + 1, ';') && !toks[b + 1].nl ? span(a, b, '') : span(a, b, ';'));
  const statementTail = (b) => { const t = toks[b + 1]; return !t || P(b + 1, ';') || P(b + 1, '}') || (t.nl && startsStatement(t)); };

  const sites = [];
  // cover is every line the mutant's edits touch, so a statement that spans lines is judged on each of them
  const add = (k, operator, edits, line = toks[k].line) => {
    const cover = new Set([line]);
    for (const e of edits) for (let l = lineOf(e.s); l <= lineOf(Math.max(e.s, e.e - 1)); l++) cover.add(l);
    sites.push({ line, at: toks[k].s, operator, edits, cover: [...cover] });
  };
  const swap = (k, to) => add(k, `${toks[k].v} -> ${to}`, [{ s: toks[k].s, e: toks[k].e, text: to }]);
  function callStatement(start, k, operator) {
    const t = toks[k];
    if (!t || !(t.t === 'id' || K(k, 'this') || K(k, 'super'))) return;
    const ch = chainAt(k);
    if (!ch || !ch.call || !statementTail(ch.end)) return;
    add(start, operator, [removal(start, ch.end)]);
  }
  // An assignment statement with no other mutant on its line is removed (assignStatement); a string that + joins is emptied.
  const assigns = [], emptied = new Set();
  function assignStatement(k) {
    const ch = chainAt(k);
    if (!ch || ch.call || toks[ch.end + 1]?.t !== 'p' || !ASSIGN.has(toks[ch.end + 1].v)) return;
    const end = exprEnd(ch.end + 2, true);
    if (end >= ch.end + 2 && statementTail(end)) assigns.push([k, end]);
  }
  for (let k = 0; k < N; k++) {
    const t = toks[k];
    if (t.t === 'p') {
      const v = t.v;
      if (v === '+' || v === '-') {
        const a = toks[k - 1], b = toks[k + 1];
        const text = (x) => x && (x.t === 'str' || x.t === 'tpl');
        if (operandEnd(k - 1) && b && !text(a) && !text(b) && (v === '-' || a.t === 'num' || b.t === 'num')) swap(k, v === '+' ? '-' : '+');
        if (v === '+' && operandEnd(k - 1) && b) {
          for (const j of [k - 1, k + 1]) {
            const x = toks[j];
            if (x.t === 'str' && x.v.length > 2 && !emptied.has(j)) {
              emptied.add(j);
              add(j, "concatenated string -> ''", [{ s: x.s, e: x.e, text: x.v[0] + x.v[0] }]);
            }
          }
        }
      } else if (SWAP[v] && (!BINARY_ONLY.has(v) || operandEnd(k - 1))) swap(k, SWAP[v]);
      else if (v === '!') add(k, '! removed', [{ s: t.s, e: t.e, text: '' }]);
      else if (v === '?') {
        let c = -1;
        for (let j = k + 1, d = 0; j < N; j++) {
          const u = toks[j];
          if (u.t !== 'p') continue;
          if ((u.v === '(' || u.v === '[' || u.v === '{') && match[j] !== undefined) { j = match[j]; continue; }
          if (u.v === ';' || u.v === ',' || u.v === ')' || u.v === ']' || u.v === '}') break;
          if (u.v === '?') d++;
          else if (u.v === ':') { if (d === 0) { c = j; break; } d--; }
        }
        const end = c > k + 1 ? exprEnd(c + 1, false) : -1;
        if (end > c) {
          const yes = src.slice(toks[k + 1].s, toks[c - 1].e), no = src.slice(toks[c + 1].s, toks[end].e);
          add(k, 'ternary branches swapped', [{ s: toks[k + 1].s, e: toks[c - 1].e, text: no }, { s: toks[c + 1].s, e: toks[end].e, text: yes }]);
        }
      }
    } else if (t.t === 'kw' && (P(k - 1, '.') || P(k - 1, '?.'))) {
      // a property name such as it.return or gen.throw, not a keyword
    } else if (t.t === 'kw') {
      const v = t.v;
      if (v === 'true' || v === 'false') {
        const key = P(k + 1, ':') && (P(k - 1, '{') || P(k - 1, ','));
        if (!P(k - 1, '.') && !P(k - 1, '?.') && !key) swap(k, v === 'true' ? 'false' : 'true');
      } else if (v === 'return') {
        const nx = toks[k + 1];
        if (!nx || nx.nl || P(k + 1, ';') || P(k + 1, '}')) add(k, 'bare return removed', [{ s: t.s, e: t.e, text: P(k + 1, ';') && !nx.nl ? '' : ';' }]);
        else {
          const end = exprEnd(k + 1, true);
          if (end > k && !(end === k + 1 && nx.v === 'undefined')) add(k, 'return value -> undefined', [span(k + 1, end, 'undefined')]);
        }
      } else if (v === 'throw') {
        const end = exprEnd(k + 1, true);
        if (end > k) add(k, 'throw removed', [removal(k, end)]);
      } else if (DECLARE.has(v)) {
        // a name or a destructuring pattern, then = and the initialiser
        const target = (j) => (toks[j]?.t === 'id' ? j : (P(j, '{') || P(j, '[')) && match[j] !== undefined ? match[j] : -1);
        for (let j = k + 1, te = target(j); te >= 0 && P(te + 1, '=') && toks[te + 2]; te = target(j)) {
          const end = exprEnd(te + 2, false);
          if (end < te + 2) break;
          if (!isFunctionValue(te + 2) && !(end === te + 2 && toks[te + 2].v === 'undefined')) {
            add(j, `${v} initialiser -> undefined`, [span(te + 2, end, 'undefined')], toks[j].line);
          }
          if (!P(end + 1, ',')) break;
          j = end + 2;
        }
      } else if ((v === 'if' || v === 'while') && P(k + 1, '(') && match[k + 1] !== undefined) {
        const c = match[k + 1];
        const ch = c > k + 2 ? chainAt(k + 2) : null;
        if (ch && ch.end === c - 1) {
          const at = toks[k + 2].s, close = toks[c].s;
          add(k, ch.call ? 'call condition negated' : 'condition negated', [{ s: at, e: at, text: '!(' }, { s: close, e: close, text: ')' }]);
        }
      } else if (v === 'await' && stmtStart(k)) callStatement(k, k + 1, 'awaited call removed');
      else if ((v === 'this' || v === 'super') && stmtStart(k)) { callStatement(k, k, 'call statement removed'); assignStatement(k); }
    } else if (t.t === 'id' && stmtStart(k)) { callStatement(k, k, 'call statement removed'); assignStatement(k); }
  }
  // one mutant is enough to judge a line, so the assignment is removed only where nothing else on its line is mutated
  for (const [k, end] of assigns) if (!sites.some((x) => x.line === toks[k].line)) add(k, 'assignment removed', [removal(k, end)]);

  // The opening bracket that encloses token k, or -1.
  function enclosing(k) {
    for (let j = k - 1; j >= 0; j--) {
      if (toks[j].t !== 'p') continue;
      if ((toks[j].v === ')' || toks[j].v === ']' || toks[j].v === '}') && match[j] !== undefined) { j = match[j]; continue; }
      if (toks[j].v === '(' || toks[j].v === '[' || toks[j].v === '{') return j;
    }
    return -1;
  }
  // A { that opens an object literal: it stands where an operand is expected, not where a block or statement starts.
  function objectBrace(o) {
    if (!P(o, '{')) return false;
    const q = toks[o - 1];
    if (!q) return false;
    if (q.t === 'kw') return ['return', 'throw', 'yield', 'await', 'typeof', 'void', 'delete', 'in'].includes(q.v);
    if (q.t !== 'p') return false;
    if (q.v === ':') return !caseColon(o - 1);
    return OPERAND_AFTER.has(q.v) || ['(', '[', ','].includes(q.v);
  }
  // The : at c separates a ternary's branches (a ? at the same depth before it) or a property from its value.
  function valueColon(c) {
    if (caseColon(c)) return false;
    for (let j = c - 1; j >= 0; j--) {
      const u = toks[j];
      if (u.t !== 'p') continue;
      if ((u.v === ')' || u.v === ']' || u.v === '}') && match[j] !== undefined) { j = match[j]; continue; }
      if (u.v === '?') return true;
      if (u.v === ',' || u.v === ';' || u.v === '(' || u.v === '[' || u.v === '{') break;
    }
    return objectBrace(enclosing(c));
  }
  // An argument of a call or an element of an array literal starts after this ( [ or ,.
  function listStart(k) {
    const o = P(k, ',') ? enclosing(k) : k;
    if (P(o, '(')) return callParen(o);
    return P(o, '[') && !operandEnd(o - 1);
  }

  // A rewrite of a line that keeps its meaning: one operand on it wrapped in parentheses. A call's arguments, an array's
  // elements, an if, while or switch condition, a property's value, and the operand after an operator, =, =>, return,
  // throw or await all take a parenthesised operand; a bare return; becomes return void 0;.
  function callParen(o) {
    if (!operandEnd(o - 1) || match[o] === undefined || P(match[o] + 1, '{') || P(match[o] + 1, '=>')) return false;
    return !(K(o - 2, 'function') || (P(o - 2, '*') && K(o - 3, 'function')) || (toks[o - 1].t === 'kw' && !VALUES.has(toks[o - 1].v)));
  }
  function operandStart(k) {
    const p = toks[k - 1];
    if (!p) return false;
    if (p.t === 'p') {
      if (p.v === '=>') return !P(k, '{');
      if (p.v === '(') return ['if', 'while', 'switch'].some((w) => K(k - 2, w)) || callParen(k - 1);
      if (p.v === '[' || p.v === ',') return listStart(k - 1);
      if (p.v === ':') return valueColon(k - 1);
      if (p.v === '++' || p.v === '--') return !operandEnd(k - 2);
      if (BINARY_ONLY.has(p.v) || p.v === '**') return operandEnd(k - 2);
      return OPERAND_AFTER.has(p.v);
    }
    if (p.t === 'kw' && ['return', 'throw', 'await', 'typeof', 'void', 'delete'].includes(p.v)) return !toks[k].nl;
    return false;
  }
  // Every rewrite of the line, best first; the caller keeps the first one that still parses. tag is a number literal chosen
  // per run: an operand X becomes (tag, X), so deleting parentheses, spaces and comments never restores the line. An
  // operand after typeof or delete, or after a prefix ++ or --, is left alone, since there the sequence would change the
  // meaning or not parse.
  function wrapLine(line, tag) {
    const out = [];
    let first = -1;
    for (let k = 0; k < N; k++) {
      if (toks[k].line !== line) continue;
      if (first < 0) first = k;
      if (K(k, 'return') && (!toks[k + 1] || toks[k + 1].nl || P(k + 1, ';') || P(k + 1, '}'))) out.push([{ at: toks[k].e, text: ` void ${tag}` }]);
      if (!operandStart(k) || K(k - 1, 'typeof') || K(k - 1, 'delete') || P(k - 1, '++') || P(k - 1, '--')) continue;
      const ch = chainAt(k, true);
      if (ch) out.push([{ at: toks[k].s, text: `(${tag}, ` }, { at: toks[ch.end].e, text: ')' }]);
    }
    // A statement that opens with a name, this, or a prefix ++ or -- on a name, as in n++; ++n; or this.save(): the whole
    // expression takes the sequence.
    const k = first;
    const update = k >= 0 && (P(k, '++') || P(k, '--')) && toks[k + 1]?.t === 'id';
    if (k >= 0 && (update || (((toks[k].t === 'id' && toks[k].v !== 'async') || K(k, 'this')) && toks[k + 1] && !P(k + 1, ':') && !P(k + 1, '=>')))) {
      const p = toks[k - 1];
      const safe = !p || P(k - 1, ';') || P(k - 1, '{') || K(k - 1, 'else') || K(k - 1, 'do') || (P(k - 1, ')') && headerParen(k - 1));
      const next = toks[k + 1];
      const end = exprEnd(k, true);
      if (safe && end >= k && statementTail(end) && (update || next.t === 'tpl' || (next.t === 'p' && STATEMENT_NAME_NEXT.has(next.v)))) {
        out.push([{ at: toks[k].s, text: `(${tag}, ` }, { at: toks[end].e, text: ')' }]);
      }
    }
    return out;
  }
  // Lines that carry code a test could check: an operator, an assignment or initialiser (not of a function or class, not a
  // parameter's default), a call, or return, throw, await, yield, delete, new, in (not a for header's) or instanceof. A
  // brace, a function or class header, an import or an export list carries none.
  function paramsAt(k) {
    const o = enclosing(k);
    if (!P(o, '(') || match[o] === undefined) return false;
    return P(match[o] + 1, '=>') || (P(match[o] + 1, '{') && !headerParen(match[o]) && !K(o - 1, 'switch') && !K(o - 1, 'catch'));
  }
  const behaviour = new Set();
  for (let k = 0; k < N; k++) {
    const t = toks[k];
    let b = false;
    if (t.t === 'kw') b = BEHAVIOUR_KW.has(t.v) && !P(k - 1, '.') && !P(k - 1, '?.') && !(t.v === 'in' && K(enclosing(k) - 1, 'for'));
    else if (t.t === 'p') {
      if (t.v === '=') b = !isFunctionValue(k + 1) && !paramsAt(k);
      else if (t.v === '(') b = callParen(k);
      else if (t.v === '*') b = operandEnd(k - 1);
      else b = !STRUCTURE.has(t.v);
    }
    if (b) behaviour.add(t.line);
  }
  const codeLines = new Set();
  for (const t of toks) for (let l = t.line; l <= t.last; l++) codeLines.add(l);
  return { toks, comments, sites, codeLines, wrapLine, behaviour };
}

export function applyEdits(src, edits) {
  let out = src;
  for (const e of [...edits].sort((a, b) => b.s - a.s)) out = out.slice(0, e.s) + e.text + out.slice(e.e);
  return out;
}
function applyInserts(src, inserts) {
  // At one offset a closing parenthesis goes before an opening one, so spans that touch stay separate.
  const sorted = [...inserts].sort((a, b) => a.at - b.at || (a.text === ')' ? -1 : 1) - (b.text === ')' ? -1 : 1));
  let out = '', last = 0;
  for (const i of sorted) { out += src.slice(last, i.at) + i.text; last = i.at; }
  return out + src.slice(last);
}
const IGNORE = /^\s*mutate-ignore:\s*(\S[\s\S]*?)\s*$/;
export function ignoreReasons(comments) {
  const at = new Map();
  for (const c of comments) { const m = IGNORE.exec(c.text); if (m && !at.has(c.line)) at.set(c.line, m[1].replace(/\s+/g, ' ')); }
  return at;
}

// ---------------------------------------------------------------------------------------------------------------------
// Git: which lines changed between the base and the working tree.

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const k of [...GIT_REDIRECT, ...REMOTE_REACH]) delete env[k];
  for (const k of Object.keys(env)) if (/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)$/.test(k)) delete env[k];
  // git's credential helpers are off for every command: an empty helper value resets the list from every config file
  return Object.assign(env, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '' });
}
function git(cwd, args) {
  const r = spawnSync('git', args, { windowsHide: true, cwd, env: cleanEnv({ GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }), encoding: 'utf8', maxBuffer: 512 << 20 });
  return { ok: r.status === 0, out: r.stdout || '', err: `${r.stderr || ''}${r.error ? r.error.message : ''}`.trim() };
}
function unquote(p) {
  if (!p.startsWith('"')) return p;
  const bytes = [];
  const esc = { n: 10, t: 9, r: 13, b: 8, f: 12, v: 11, a: 7, '"': 34, '\\': 92 };
  for (let i = 1; i < p.length - 1; i++) {
    if (p[i] !== '\\') { bytes.push(...Buffer.from(p[i])); continue; }
    const c = p[++i];
    if (/[0-7]/.test(c)) { bytes.push(parseInt(p.slice(i, i + 3), 8)); i += 2; } else bytes.push(esc[c] ?? c.charCodeAt(0));
  }
  return Buffer.from(bytes).toString('utf8');
}
export function inMutationSet(file) {
  return MUTATION_DIRS.some((d) => file.startsWith(`${d}/`)) && MUTATION_EXTS.some((x) => file.endsWith(x));
}
export function globMatcher(glob) {
  if (!/[*?]/.test(glob)) { const g = glob.replace(/\/+$/, ''); return (f) => f === g || f.startsWith(`${g}/`); }
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { i++; if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*'; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const rx = new RegExp(`^${re}$`);
  return (f) => rx.test(f);
}
// Lines added or changed between base and the working tree, by file, on the new side: tracked files through git diff
// (renames followed, so a moved file counts only its edited lines) and every line of an untracked file. --text reads a file
// under a -diff or binary attribute as text; a changed file whose diff still shows no lines ("Binary files ... differ") is
// returned in binary, so its change is unjudged.
export function changedLines(root, base, binary = new Set()) {
  const files = new Map();
  const r = git(root, ['-c', 'core.quotepath=off', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-relative', '-M',
    '--text', '--unified=0', '--src-prefix=a/', '--dst-prefix=b/', base, '--', ...MUTATION_DIRS]);
  if (!r.ok) throw new Error(`git diff failed: ${r.err}`);
  let file = null, oldLeft = 0, newLeft = 0, line = 0;
  for (const l of r.out.split('\n')) {
    if (oldLeft > 0 || newLeft > 0) {
      if (l.startsWith('+')) { if (file) files.get(file).add(line); line++; newLeft--; }
      else if (l.startsWith('-')) oldLeft--;
      else if (!l.startsWith('\\')) { oldLeft--; newLeft--; line++; }
      continue;
    }
    if (l.startsWith('+++ ')) {
      const p = l.slice(4).replace(/\t$/, '');
      file = p === '/dev/null' ? null : unquote(p).replace(/^b\//, '');
      if (file && !files.has(file)) files.set(file, new Set());
      continue;
    }
    const bin = /^Binary files (?:"?a\/.*"?|\/dev\/null) and ("?b\/.*"?) differ$/.exec(l);
    if (bin) { const f = unquote(bin[1]).replace(/^b\//, ''); if (inMutationSet(f)) binary.add(f); continue; }
    const m = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);
    if (m) { oldLeft = m[1] === undefined ? 1 : Number(m[1]); line = Number(m[2]); newLeft = m[3] === undefined ? 1 : Number(m[3]); }
  }
  const u = git(root, ['ls-files', '-z', '--others', '--exclude-standard', '--', ...MUTATION_DIRS]);
  if (!u.ok) throw new Error(`git ls-files failed: ${u.err}`);
  for (const f of u.out.split('\0').filter(Boolean)) {
    let text;
    try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    const count = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    files.set(f, new Set(Array.from({ length: count }, (_, i) => i + 1)));
  }
  const out = new Map();
  for (const f of [...files.keys()].sort()) if (inMutationSet(f) && files.get(f).size) out.set(f, [...files.get(f)].sort((a, b) => a - b));
  return out;
}
// A hash over every file in the mutation directories, to show the caller's tree is the same after the run.
function treeHash(root) {
  const r = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...MUTATION_DIRS]);
  const h = crypto.createHash('sha256');
  for (const f of [...new Set(r.out.split('\0').filter(Boolean))].sort()) {
    h.update(`${f}\0`);
    try { h.update(fs.readFileSync(path.join(root, f))); } catch { h.update('\0missing'); }
    h.update('\0');
  }
  return h.digest('hex');
}

// ---------------------------------------------------------------------------------------------------------------------
// The plan: every mutant of every changed line, the lines skipped by a reason, the lines that produced no mutant, and the
// lines that carry code and so need a judged mutant (needs). A changed file that is a link to a place outside the
// repository is never mutated, so no write in a copy can reach outside it; its lines are unjudged from the start, as are
// those of a file the tokenizer cannot read.

const inside = (p, dir) => { const rel = path.relative(dir, p); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
function plan(root, changes) {
  const mutants = [], unmutated = [], ignores = [], files = [], unjudged = [], needs = [];
  for (const [file, lines] of changes) {
    const abs = path.join(root, file);
    let real;
    try { real = fs.realpathSync(abs); } catch { real = null; }
    if (real === null || !inside(real, root)) {
      for (const l of lines) { unmutated.push({ file, line: l }); unjudged.push({ file, line: l, why: 'a link to a file outside the repository' }); }
      continue;
    }
    // a link to a file inside the repository produces no mutant itself: that file is judged where it lives, when it changed
    if (fs.lstatSync(abs).isSymbolicLink()) { for (const l of lines) unmutated.push({ file, line: l }); continue; }
    const src = fs.readFileSync(abs, 'utf8');
    let a;
    try { a = analyse(src); } catch {
      for (const l of lines) {
        if (!(src.split('\n')[l - 1] || '').trim()) continue;
        unmutated.push({ file, line: l });
        unjudged.push({ file, line: l, why: 'the file could not be read as JavaScript' });
      }
      continue;
    }
    const reasons = ignoreReasons(a.comments);
    const byLine = new Map();
    for (const s of a.sites) { if (!byLine.has(s.line)) byLine.set(s.line, []); byLine.get(s.line).push(s); }
    // the lines a skipped mutant would have covered are skipped with it
    const skipped = new Set(reasons.keys());
    for (const s of a.sites) if (reasons.has(s.line)) for (const l of s.cover) skipped.add(l);
    const code = [], mutantLines = [];
    for (const l of lines) {
      if (a.codeLines.has(l)) code.push(l);
      if (reasons.has(l)) { ignores.push({ file, line: l, reason: reasons.get(l) }); continue; }
      const here = (byLine.get(l) || []).sort((x, y) => x.at - y.at);
      if (!here.length && a.codeLines.has(l)) unmutated.push({ file, line: l });
      if (here.length) mutantLines.push(l);
      for (const s of here) mutants.push({ file, line: l, operator: s.operator, src, edits: s.edits, cover: s.cover });
      if (!skipped.has(l) && (here.length || a.behaviour.has(l))) needs.push({ file, line: l, sites: here.length });
    }
    files.push({ file, src, lines: code, mutantLines, wrapLine: a.wrapLine });
  }
  return { mutants, unmutated, ignores, files, unjudged, needs };
}
// The lines that needed a judged mutant and got none: no mutant covers them, or each one there was invalid or timed out.
function openLines(p, results) {
  const judged = new Set();
  p.mutants.forEach((m, i) => {
    const r = results[i];
    if (r && (r.outcome === 'killed' || r.outcome === 'survived')) for (const l of m.cover) judged.add(`${m.file}:${l}`);
  });
  return p.needs.filter((n) => !judged.has(`${n.file}:${n.line}`))
    .map(({ file, line, sites }) => ({ file, line, why: sites ? 'each mutant there was invalid or timed out' : 'no mutant covers it' }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Copies. Each test run gets a fresh, self-contained copy: the working tree as it is (ignored files included) and a
// repository of its own whose objects are those reachable from the base, packed from the caller's repository. Its HEAD is
// the base on the caller's branch name, and the change is uncommitted work, so no ref, reflog entry or object in a copy
// holds a changed file's new text. It takes the caller's settings but no remote, URL rewrite, credential or HTTP header,
// and nothing in it links back to the caller's repository.

function seedCopy(root, dest, base) {
  const dotgit = path.join(root, '.git');
  fs.cpSync(root, dest, { ...COPY, filter: (s) => s !== dotgit });
  const where = (arg) => path.resolve(root, git(root, ['rev-parse', arg]).out.trim());
  const common = where('--git-common-dir'), own = where('--git-dir');
  const format = git(root, ['rev-parse', '--show-object-format']).out.trim() || 'sha1';
  const must = (r, what) => { if (!r.ok) throw new Error(`could not make a self-contained copy (${what}): ${r.err}`); return r; };
  must(git(dest, ['init', '-q', '--template=', ...(format === 'sha1' ? [] : [`--object-format=${format}`])]), 'init');
  const gd = path.join(dest, '.git');
  const files = [path.join(common, 'config')];
  if (fs.existsSync(path.join(own, 'config.worktree'))) files.push(path.join(own, 'config.worktree'));
  for (const f of files) {
    for (const e of must(git(root, ['config', '--file', f, '--list', '--null']), 'read config').out.split('\0').filter(Boolean)) {
      const nl = e.indexOf('\n');
      const key = nl < 0 ? e : e.slice(0, nl);
      if (!SKIP_CONFIG.test(key)) must(git(dest, ['config', '--add', key, nl < 0 ? 'true' : e.slice(nl + 1)]), `set ${key}`);
    }
  }
  for (const f of ['shallow', path.join('info', 'exclude'), path.join('info', 'attributes')]) {
    if (fs.existsSync(path.join(common, f))) { fs.mkdirSync(path.dirname(path.join(gd, f)), { recursive: true }); fs.copyFileSync(path.join(common, f), path.join(gd, f)); }
  }
  const pack = spawnSync('git', ['pack-objects', '--revs', '-q', path.join(gd, 'objects', 'pack', 'pack')],
    { windowsHide: true, cwd: root, env: cleanEnv({ GIT_OPTIONAL_LOCKS: '0' }), input: `${base}\n`, encoding: 'utf8' });
  if (pack.status !== 0) throw new Error(`could not make a self-contained copy (pack the base): ${pack.stderr || pack.error?.message}`);
  const branch = git(root, ['symbolic-ref', '-q', 'HEAD']).out.trim();
  if (branch) { must(git(dest, ['symbolic-ref', 'HEAD', branch]), 'HEAD'); must(git(dest, ['update-ref', branch, base]), 'branch'); }
  else must(git(dest, ['update-ref', '--no-deref', 'HEAD', base]), 'HEAD');
  must(git(dest, ['read-tree', base]), 'index');
  git(dest, ['update-index', '-q', '--refresh']); // exits 1 when files differ from the base, as the change makes them
}
// The gate's own refusing stubs for STUBBED, in a folder each test command finds first on its PATH.
function writeStubs(dir) {
  fs.mkdirSync(dir, { mode: 0o700 });
  for (const name of STUBBED) {
    const msg = `mutation gate: ${name} is refused while a test runs under the gate`;
    if (process.platform === 'win32') fs.writeFileSync(path.join(dir, `${name}.cmd`), `@echo ${msg} 1>&2\r\n@exit /b 1\r\n`);
    else fs.writeFileSync(path.join(dir, name), `#!/bin/sh\necho '${msg}' >&2\nexit 1\n`, { mode: 0o755 });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Running the test command.

function killGroup(child) {
  if (!child.pid) return;
  try { if (process.platform === 'win32') child.kill('SIGKILL'); else process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
}
function exec(ctx, cwd, env, limitMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const win = process.platform === 'win32';
    const child = spawn(win ? process.env.ComSpec || 'cmd.exe' : '/bin/sh', win ? ['/d', '/s', '/c', ctx.cmd] : ['-c', ctx.cmd],
      { windowsHide: true, cwd, env, detached: !win, stdio: ['ignore', 'pipe', 'pipe'], windowsVerbatimArguments: win });
    ctx.children.add(child);
    let out = '', timedOut = false, done = false, grace = null;
    const keep = (d) => { out += d; if (out.length > 1 << 20) out = out.slice(-(1 << 19)); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => { timedOut = true; killGroup(child); }, limitMs);
    const finish = (code, signal) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(grace);
      ctx.children.delete(child);
      resolve({ pass: !timedOut && code === 0, code, signal, timedOut, ms: Date.now() - t0, out });
    };
    // Once the command has exited, anything it left running in its group is stopped too. A process that left the group
    // (detached) can still hold the output pipes open; the result waits for them only PIPE_GRACE_MS.
    child.on('exit', (code, signal) => {
      killGroup(child);
      grace = setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); finish(code, signal); }, PIPE_GRACE_MS);
    });
    child.on('error', (e) => { keep(e.message); finish(null, null); });
    child.on('close', finish);
  });
}
function testEnv(ctx, box, cwd) {
  const env = cleanEnv({ GIT_TERMINAL_PROMPT: '0' });
  delete env.NODE_TEST_CONTEXT; // a test command that runs node --test reports on its own, not to a runner above the gate
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  env[pathKey] = env[pathKey] ? `${ctx.stubs}${path.delimiter}${env[pathKey]}` : ctx.stubs;
  const dirs = { HOME: 'home', MEMEV_CONFIG_DIR: 'config', XDG_CONFIG_HOME: 'xdg', MEMEV_ROOT: 'root', MEMEV_TEST_TMP: 'test-tmp', TMPDIR: 'tmp' };
  fs.mkdirSync(path.join(box, 'env'), { mode: 0o700 });
  for (const [k, d] of Object.entries(dirs)) { env[k] = path.join(box, 'env', d); fs.mkdirSync(env[k], { mode: 0o700 }); }
  env.TMP = env.TEMP = env.TMPDIR;
  if (process.platform === 'win32') env.USERPROFILE = env.HOME;
  env.MEMEV_NO_SERVICE = env.MEMEV_NO_TUNNEL = env.MEMEV_NO_BACKGROUND = '1';
  env.PWD = cwd;
  return env;
}
// One run of the test command in a fresh copy. prepare(work) edits the copy first; when it returns false the run is skipped.
async function runOnce(ctx, prepare, limitMs) {
  const box = path.join(ctx.runDir, `r${++ctx.seq}`);
  try {
    fs.mkdirSync(box, { mode: 0o700 });
    fs.mkdirSync(path.join(box, 'w'), { mode: 0o700 });
    const work = path.join(box, 'w', ctx.name);
    fs.cpSync(ctx.seed, work, COPY);
    if (prepare && prepare(work) === false) return { invalid: true };
    const cwd = path.join(work, ctx.rel);
    return await exec(ctx, cwd, testEnv(ctx, box, cwd), limitMs);
  } finally {
    fs.rmSync(box, { recursive: true, force: true, maxRetries: 3 });
  }
}
// Writes a mutated or rewritten source into a copy. The file must be a regular file inside the copy, never a link and
// never under a linked folder, so the write cannot reach outside the copy.
function writeIn(work, file, text) {
  const target = path.join(work, file);
  const st = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!st || !st.isFile() || !inside(fs.realpathSync(target), fs.realpathSync(work))) {
    throw new Error(`refused to write ${file} in a copy: it is not a regular file inside the copy`);
  }
  fs.writeFileSync(target, text);
}
function parses(file) {
  const r = spawnSync(process.execPath, ['--check', file], { windowsHide: true, cwd: path.dirname(file), env: cleanEnv(), encoding: 'utf8', timeout: CHECK_LIMIT_MS });
  return r.status === 0;
}
// The pass count a test runner printed (node --test's TAP or spec summary, or mocha's), or null.
export function passCount(out) {
  let last = null;
  for (const m of out.matchAll(/^\s*(?:#|\u2139)\s*pass\s+(\d+)\s*$/gm)) last = Number(m[1]);
  if (last === null) for (const m of out.matchAll(/^\s*(\d+) passing\b/gm)) last = Number(m[1]);
  return last;
}
// The rewrite control: every changed line of every changed file with one operand X written (tag, X). A file whose
// rewrite does not parse is rewritten line by line, each line taking the first of its rewrites that still parses. Every
// line that carries a mutant must be rewritten, or a test that reacts to the source text there would read as a kill; when
// one is not, the control returns false and the run stops as noise without running the tests.
function rewriteControl(work, files, res) {
  let lines = 0, wrapped = 0;
  const unchanged = [];
  const tag = `0x${crypto.randomBytes(4).toString('hex')}`; // chosen per run, so no test can carry the rewritten text
  for (const f of files) {
    const target = path.join(work, f.file);
    const options = new Map(f.lines.map((l) => [l, f.wrapLine(l, tag)]).filter(([, w]) => w.length));
    lines += f.lines.length;
    const done = new Set();
    if (options.size) {
      const first = [...options.values()].flatMap((w) => w[0]);
      writeIn(work, f.file, applyInserts(f.src, first));
      if (parses(target)) for (const l of options.keys()) done.add(l);
      else {
        let kept = [];
        for (const [l, ws] of options) {
          for (const w of ws) {
            writeIn(work, f.file, applyInserts(f.src, [...kept, ...w]));
            if (parses(target)) { kept = [...kept, ...w]; done.add(l); break; }
          }
        }
        writeIn(work, f.file, applyInserts(f.src, kept));
      }
    }
    wrapped += done.size;
    for (const l of f.mutantLines) if (!done.has(l)) unchanged.push({ file: f.file, line: l });
  }
  res.rewrite = { lines, wrapped, unchanged };
  return unchanged.length === 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// The run.

function blank() {
  return { version: GATE_VERSION, status: 'error', reason: '', base: null, mutants: 0, killed: 0, survived: null, invalid: 0, timeout: 0, ignored: 0,
    noise: 0, survivors: [], unmutated: [], unjudged: [], timeouts: [], ignores: [], files: [], timeoutMs: null, controls: [], rewrite: null, results: [] };
}
function finish(res) {
  const ok = res.status === 'ok';
  const judged = res.results.filter((r) => r.outcome === 'killed' || r.outcome === 'survived');
  const count = (list, outcome) => list.filter((r) => r.outcome === outcome).length;
  res.mutants = ok ? judged.length : 0;
  res.killed = ok ? count(judged, 'killed') : 0;
  res.survived = ok ? count(judged, 'survived') : null;
  res.invalid = count(res.results, 'invalid');
  res.timeout = count(res.results, 'timeout');
  res.timeouts = res.results.filter((r) => r.outcome === 'timeout').map(({ file, line, operator }) => ({ file, line, operator }));
  res.ignored = res.ignores.length;
  res.survivors = ok ? judged.filter((r) => r.outcome === 'survived').map(({ file, line, operator }) => ({ file, line, operator })) : [];
  res.files = res.files.map(({ file }) => {
    const mine = res.results.filter((r) => r.file === file);
    const j = mine.filter((r) => r.outcome === 'killed' || r.outcome === 'survived');
    return { file, mutants: ok ? j.length : 0, killed: ok ? count(j, 'killed') : 0, survived: ok ? count(j, 'survived') : null,
      invalid: count(mine, 'invalid'), timeout: count(mine, 'timeout'), ignored: res.ignores.filter((i) => i.file === file).length };
  });
  return res;
}
export function exitCode(res) {
  if (res.status === 'ok') return res.survived > 0 ? EXIT.survived : EXIT.pass;
  return EXIT[res.status] ?? EXIT.error;
}

async function judge(ctx, p, res) {
  const noise = (reason) => { res.status = 'noise'; res.reason = reason; res.noise++; };
  const control = (kind, r) => { res.controls.push({ kind, pass: r.pass, timedOut: r.timedOut, ms: r.ms, passCount: passCount(r.out) }); return r; };
  const c1 = control('unmutated', await runOnce(ctx, null, CONTROL_LIMIT_MS));
  if (!c1.pass) return noise('the tests fail on the unmutated tree');
  const c2 = control('unmutated', await runOnce(ctx, null, CONTROL_LIMIT_MS));
  if (!c2.pass) return noise('the tests fail on the second run on the unmutated tree');
  if (passCount(c1.out) !== passCount(c2.out)) return noise(`the pass count differs between two unmutated runs (${passCount(c1.out)}, ${passCount(c2.out)})`);
  res.timeoutMs = Math.ceil(5 * Math.max(c1.ms, c2.ms) + 10000);
  const rr = await runOnce(ctx, (work) => rewriteControl(work, p.files, res), res.timeoutMs);
  if (rr.invalid) {
    res.controls.push({ kind: 'rewrite', pass: false, timedOut: false, ms: 0, passCount: null, ran: false });
    const at = res.rewrite.unchanged.map((u) => `${u.file}:${u.line}`).join(', ');
    return noise(`the rewrite control could not change ${at}, so a test that reacts to the source text there would read as a kill`);
  }
  const rc = control('rewrite', rr);
  if (!rc.pass) return noise('the tests fail when the changed lines are rewritten to the same meaning, so they react to the source text');
  for (const m of p.mutants) {
    const text = applyEdits(m.src, m.edits);
    const entry = { file: m.file, line: m.line, operator: m.operator, outcome: 'invalid', ms: null };
    res.results.push(entry);
    const r1 = await runOnce(ctx, (work) => { writeIn(work, m.file, text); return parses(path.join(work, m.file)); }, res.timeoutMs);
    if (r1.invalid) continue;
    entry.ms = r1.ms;
    if (r1.timedOut) { entry.outcome = 'timeout'; continue; }
    const r2 = await runOnce(ctx, (work) => { writeIn(work, m.file, text); }, res.timeoutMs);
    if (r2.timedOut || r1.pass !== r2.pass) {
      entry.outcome = 'noise';
      return noise(`the two runs on ${m.file}:${m.line} (${m.operator}) disagree`);
    }
    entry.outcome = r1.pass ? 'survived' : 'killed';
  }
  const fc = control('final', await runOnce(ctx, null, res.timeoutMs));
  if (!fc.pass) return noise('the tests fail on the unmutated tree after the last mutant, so no kill is accepted');
  const judged = res.results.some((r) => r.outcome === 'killed' || r.outcome === 'survived');
  res.status = judged ? 'ok' : 'no-mutants';
  if (!judged) res.reason = 'no mutant could be judged (each one was invalid or timed out)';
}

export async function runGate({ cwd = process.cwd(), base, test, scopes = [] } = {}) {
  const res = blank();
  const fail = (reason) => { res.status = 'error'; res.reason = reason; return finish(res); };
  if (typeof base !== 'string' || base === '') return fail('--base needs a commit');
  if (base.startsWith('-')) return fail('--base must not begin with -');
  if (typeof test !== 'string' || !test.trim()) return fail('--test needs a command');
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  if (!top.ok || !top.out.trim()) return fail('not inside a git working tree');
  const root = fs.realpathSync(top.out.trim());
  const sha = git(root, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
  if (!sha.ok) return fail(`--base ${base} is not a commit in this repository`);
  res.base = sha.out.trim();
  let changes;
  const binary = new Set();
  try { changes = changedLines(root, res.base, binary); } catch (e) { return fail(e.message); }
  if (scopes.length) {
    const tests = scopes.map(globMatcher);
    for (const f of [...changes.keys()]) if (!tests.some((t) => t(f))) changes.delete(f);
    for (const f of [...binary]) if (!tests.some((t) => t(f))) binary.delete(f);
  }
  const p = plan(root, changes);
  for (const f of [...binary].sort()) p.unjudged.push({ file: f, line: null, why: 'a changed file whose diff shows no lines' });
  Object.assign(res, { unmutated: p.unmutated, ignores: p.ignores, files: p.files.map(({ file }) => ({ file })) });
  // until the run judges, the unjudged lines are those it can never judge: refused or unreadable files, lines with no mutant
  res.unjudged = [...p.unjudged, ...openLines({ mutants: [], needs: p.needs.filter((n) => !n.sites) }, [])];
  if (!p.mutants.length) {
    res.status = 'no-mutants';
    res.reason = changes.size ? 'no changed line produced a mutant' : 'no line changed in the mutation set';
    return finish(res);
  }
  const before = treeHash(root);
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), RUN_PREFIX));
  fs.chmodSync(runDir, 0o700);
  const ctx = { runDir, cmd: test, rel: path.relative(root, fs.realpathSync(cwd)), name: path.basename(root), seq: 0, children: new Set(),
    stubs: path.join(runDir, 'stubs') };
  ctx.seed = path.join(runDir, 'seed', ctx.name);
  const cleanup = () => { for (const c of ctx.children) killGroup(c); fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 3 }); };
  const onSignal = (sig) => { cleanup(); process.exit(sig === 'SIGINT' ? 130 : 143); };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    fs.mkdirSync(path.dirname(ctx.seed), { mode: 0o700 });
    writeStubs(ctx.stubs);
    seedCopy(root, ctx.seed, res.base);
    await judge(ctx, p, res);
  } catch (e) {
    res.status = 'error';
    res.reason = e.message;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    cleanup();
  }
  if (treeHash(root) !== before) { res.status = 'error'; res.reason = 'the working tree changed during the run'; }
  else if (res.status === 'ok') {
    // a changed line that carries code and that no judged mutant covers leaves the change unjudged, so the run is not ok
    res.unjudged = [...p.unjudged, ...openLines(p, res.results)];
    if (res.unjudged.length) {
      res.status = 'error';
      res.reason = `${res.unjudged.length} changed line(s) carry code that no judged mutant covers`;
    }
  }
  return finish(res);
}

export function parseArgs(argv) {
  const o = { scopes: [], json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    const flag = eq > 0 ? a.slice(0, eq) : a;
    const value = () => {
      if (eq > 0) return a.slice(eq + 1);
      if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`);
      return argv[++i];
    };
    if (flag === '--base') o.base = value();
    else if (flag === '--test') o.test = value();
    else if (flag === '--scope') o.scopes.push(value());
    else if (a === '--json') o.json = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return o;
}
function report(res) {
  const lines = [];
  if (res.status === 'ok') {
    lines.push(`mutation gate: ${res.mutants} mutants judged, ${res.killed} killed, ${res.survived} survived` +
      ` (${res.invalid} invalid, ${res.timeout} timed out, ${res.ignored} lines ignored; time limit ${res.timeoutMs} ms)`);
  } else lines.push(`mutation gate: ${res.status.toUpperCase()}: ${res.reason}`);
  for (const s of res.survivors) lines.push(`  survived   ${s.file}:${s.line}  ${s.operator}`);
  for (const u of res.unmutated) lines.push(`  no mutant  ${u.file}:${u.line}`);
  for (const t of res.timeouts) lines.push(`  timed out  ${t.file}:${t.line}  ${t.operator}`);
  for (const u of res.unjudged) lines.push(`  unjudged   ${u.file}${u.line === null ? '' : `:${u.line}`}  ${u.why}`);
  for (const g of res.ignores) lines.push(`  ignored    ${g.file}:${g.line}  ${g.reason}`);
  return `${lines.join('\n')}\n`;
}
export async function main(argv, { cwd = process.cwd(), stdout = process.stdout } = {}) {
  let o;
  try { o = parseArgs(argv); } catch (e) {
    const res = blank(); res.reason = e.message; finish(res);
    stdout.write(argv.includes('--json') ? `${JSON.stringify(res, null, 2)}\n` : `${report(res)}${USAGE}`);
    return exitCode(res);
  }
  if (o.help) { stdout.write(USAGE); return 0; }
  const res = await runGate({ cwd, base: o.base, test: o.test, scopes: o.scopes });
  stdout.write(o.json ? `${JSON.stringify(res, null, 2)}\n` : report(res));
  return exitCode(res);
}
