// SPDX-License-Identifier: Apache-2.0
// The mutation gate breaks each line a change added or edited, one mutant at a time, and fails when the tests still pass.
// Before judging, the unmutated tests run twice, then once with every changed line rewritten to the same meaning; each
// mutant is judged on two runs, each in its own copy of the repository; the unmutated tests run once more before a kill is
// accepted. A failing control stops the run as noise. scripts/gate/mutate.mjs is the command line over this module.
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
// Variables that point git at another repository, index or config file. Neither the gate's own git calls nor a test
// command see them, so each reaches only the repository it runs in.
const GIT_REDIRECT = ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_CONFIG', 'GIT_CONFIG_GLOBAL'];
const COPY = { recursive: true, verbatimSymlinks: true, mode: fs.constants.COPYFILE_FICLONE };

export const USAGE = `Usage: node scripts/gate/mutate.mjs --base <sha> --test <cmd> [--scope <glob>]... [--json]
  Mutates the lines added or changed since <sha> in .mjs, .js and .cjs files under src/, vendor/ and bin/, one mutant at a
  time, and runs <cmd> on each. Exit 0 when every judged mutant is killed, 1 when one survives, 2 on noise or an error,
  3 when no mutant could be judged. A line with the comment "mutate-ignore: <reason>" is skipped.
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
      let t;
      if (c === '"' || c === "'") { k = readStr(k); t = 'str'; }
      else if (c === '`') { k = readTpl(k); t = 'tpl'; }
      else if ((c >= '0' && c <= '9') || (c === '.' && src[k + 1] >= '0' && src[k + 1] <= '9')) {
        NUMBER.lastIndex = k; const m = NUMBER.exec(src); k += m ? m[0].length : 1; t = 'num';
      } else if (c === '#' || c === '\\' || idChar(k, ID_START)) { k = readId(k); t = KEYWORDS.has(src.slice(s, k)) ? 'kw' : 'id'; }
      else if (c === '/' && !endsOperand(out)) { k = readRegex(k); t = 're'; }
      else {
        let v = PUNCT.find((p) => src.startsWith(p, k)) || c;
        if (v === '?.' && /\d/.test(src[k + 2] || '')) v = '?';
        k += v.length; t = 'p';
        if (v === '{') depth++;
        else if (v === '}') { if (inBrace && depth === 0) return k; depth--; }
      }
      out.push({ t, v: src.slice(s, k), s, e: k, nl });
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
const newlines = (text) => text.replace(/[^\n]/g, '');

export function analyse(src) {
  const { toks, comments } = tokenize(src);
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
  const add = (k, operator, edits, line = toks[k].line) => sites.push({ line, at: toks[k].s, operator, edits });
  const swap = (k, to) => add(k, `${toks[k].v} -> ${to}`, [{ s: toks[k].s, e: toks[k].e, text: to }]);
  function callStatement(start, k, operator) {
    const t = toks[k];
    if (!t || !(t.t === 'id' || K(k, 'this') || K(k, 'super'))) return;
    const ch = chainAt(k);
    if (!ch || !ch.call || !statementTail(ch.end)) return;
    add(start, operator, [removal(start, ch.end)]);
  }
  for (let k = 0; k < N; k++) {
    const t = toks[k];
    if (t.t === 'p') {
      const v = t.v;
      if (v === '+' || v === '-') {
        const a = toks[k - 1], b = toks[k + 1];
        const text = (x) => x && (x.t === 'str' || x.t === 'tpl');
        if (operandEnd(k - 1) && b && !text(a) && !text(b) && (v === '-' || a.t === 'num' || b.t === 'num')) swap(k, v === '+' ? '-' : '+');
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
      } else if (v === 'const') {
        for (let j = k + 1; toks[j]?.t === 'id' && P(j + 1, '=') && toks[j + 2];) {
          const end = exprEnd(j + 2, false);
          if (end < j + 2) break;
          if (!isFunctionValue(j + 2) && !(end === j + 2 && toks[j + 2].v === 'undefined')) {
            add(j, 'const initialiser -> undefined', [span(j + 2, end, 'undefined')], toks[j].line);
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
      else if ((v === 'this' || v === 'super') && stmtStart(k)) callStatement(k, k, 'call statement removed');
    } else if (t.t === 'id' && stmtStart(k)) callStatement(k, k, 'call statement removed');
  }

  // A rewrite of a line that keeps its meaning: one operand on it wrapped in parentheses. A call's arguments, an if, while
  // or switch condition, and the operand after an operator, =, =>, return, throw or await all take a parenthesised operand.
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
      if (BINARY_ONLY.has(p.v) || p.v === '**') return operandEnd(k - 2);
      return OPERAND_AFTER.has(p.v);
    }
    if (p.t === 'kw' && ['return', 'throw', 'await', 'typeof', 'void', 'delete'].includes(p.v)) return !toks[k].nl;
    return false;
  }
  function wrapLine(line) {
    let first = -1;
    for (let k = 0; k < N; k++) {
      if (toks[k].line !== line) continue;
      if (first < 0) first = k;
      if (!operandStart(k)) continue;
      const ch = chainAt(k, true);
      if (ch) return [{ at: toks[k].s, text: '(' }, { at: toks[ch.end].e, text: ')' }];
    }
    // A statement that opens with a name, as in n++; or save(); the name alone takes the parentheses.
    const k = first;
    if (k >= 0 && toks[k].t === 'id' && toks[k].v !== 'async' && toks[k + 1] && !P(k + 1, ':') && !P(k + 1, '=>')) {
      const p = toks[k - 1];
      const safe = !p || P(k - 1, ';') || P(k - 1, '{') || K(k - 1, 'else') || K(k - 1, 'do') || (P(k - 1, ')') && headerParen(k - 1));
      const next = toks[k + 1];
      if (safe && (next.t === 'tpl' || (next.t === 'p' && STATEMENT_NAME_NEXT.has(next.v)))) {
        return [{ at: toks[k].s, text: '(' }, { at: toks[k].e, text: ')' }];
      }
    }
    return null;
  }
  const codeLines = new Set();
  for (const t of toks) for (let l = t.line; l <= t.last; l++) codeLines.add(l);
  return { toks, comments, sites, codeLines, wrapLine };
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
  for (const k of GIT_REDIRECT) delete env[k];
  return env;
}
function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, env: cleanEnv({ GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }), encoding: 'utf8', maxBuffer: 512 << 20 });
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
// (renames followed, so a moved file counts only its edited lines) and every line of an untracked file.
export function changedLines(root, base) {
  const files = new Map();
  const r = git(root, ['-c', 'core.quotepath=off', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-relative', '-M',
    '--unified=0', '--src-prefix=a/', '--dst-prefix=b/', base, '--', ...MUTATION_DIRS]);
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
// The plan: every mutant of every changed line, the lines skipped by a reason, and the lines that produced no mutant.

function plan(root, changes) {
  const mutants = [], unmutated = [], ignores = [], files = [];
  for (const [file, lines] of changes) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    let a;
    try { a = analyse(src); } catch {
      for (const l of lines) if ((src.split('\n')[l - 1] || '').trim()) unmutated.push({ file, line: l });
      continue;
    }
    const reasons = ignoreReasons(a.comments);
    const byLine = new Map();
    for (const s of a.sites) { if (!byLine.has(s.line)) byLine.set(s.line, []); byLine.get(s.line).push(s); }
    const code = [];
    for (const l of lines) {
      if (a.codeLines.has(l)) code.push(l);
      if (reasons.has(l)) { ignores.push({ file, line: l, reason: reasons.get(l) }); continue; }
      const here = (byLine.get(l) || []).sort((x, y) => x.at - y.at);
      if (!here.length) { if (a.codeLines.has(l)) unmutated.push({ file, line: l }); continue; }
      for (const s of here) mutants.push({ file, line: l, operator: s.operator, src, edits: s.edits });
    }
    files.push({ file, src, lines: code, wrapLine: a.wrapLine });
  }
  return { mutants, unmutated, ignores, files };
}

// ---------------------------------------------------------------------------------------------------------------------
// Copies. Each test run gets a fresh, self-contained copy: the working tree as it is (ignored files included) and a
// .git of its own. A linked worktree's .git file is replaced by a copy of the shared repository with this worktree's
// HEAD and index; alternates are repacked away. Nothing in a copy links back to the caller's repository.

function copyGitDir(from, to) {
  const skip = path.join(from, 'worktrees');
  fs.cpSync(from, to, { ...COPY, filter: (s) => s !== skip && !s.endsWith('.lock') });
}
function seedCopy(root, dest) {
  const dotgit = path.join(root, '.git');
  fs.cpSync(root, dest, { ...COPY, filter: (s) => s !== dotgit });
  const gd = path.join(dest, '.git');
  if (fs.statSync(dotgit).isDirectory()) copyGitDir(fs.realpathSync(dotgit), gd);
  else {
    const own = path.resolve(root, git(root, ['rev-parse', '--git-dir']).out.trim());
    const common = path.resolve(root, git(root, ['rev-parse', '--git-common-dir']).out.trim());
    copyGitDir(common, gd);
    for (const f of ['HEAD', 'index', 'config.worktree', 'ORIG_HEAD', 'MERGE_HEAD']) {
      const p = path.join(own, f);
      if (fs.existsSync(p)) fs.copyFileSync(p, path.join(gd, f)); else fs.rmSync(path.join(gd, f), { force: true });
    }
    git(dest, ['config', 'core.bare', 'false']);
    git(dest, ['config', '--unset', 'core.worktree']);
  }
  const alt = path.join(gd, 'objects', 'info', 'alternates');
  if (fs.existsSync(alt)) {
    const r = git(dest, ['repack', '-a', '-d', '-q']);
    if (!r.ok) throw new Error(`could not make a self-contained copy: ${r.err}`);
    fs.rmSync(alt);
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
      { cwd, env, detached: !win, stdio: ['ignore', 'pipe', 'pipe'], windowsVerbatimArguments: win });
    ctx.children.add(child);
    let out = '', timedOut = false, done = false;
    const keep = (d) => { out += d; if (out.length > 1 << 20) out = out.slice(-(1 << 19)); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => { timedOut = true; killGroup(child); }, limitMs);
    const finish = (code, signal) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ctx.children.delete(child);
      resolve({ pass: !timedOut && code === 0, code, signal, timedOut, ms: Date.now() - t0, out });
    };
    // Once the command has exited, anything it left running in its group is stopped too.
    child.on('exit', () => killGroup(child));
    child.on('error', (e) => { keep(e.message); finish(null, null); });
    child.on('close', finish);
  });
}
function testEnv(box, cwd) {
  const env = cleanEnv();
  delete env.NODE_TEST_CONTEXT; // a test command that runs node --test reports on its own, not to a runner above the gate
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
    return await exec(ctx, cwd, testEnv(box, cwd), limitMs);
  } finally {
    fs.rmSync(box, { recursive: true, force: true, maxRetries: 3 });
  }
}
function parses(file) {
  const r = spawnSync(process.execPath, ['--check', file], { cwd: path.dirname(file), env: cleanEnv(), encoding: 'utf8', timeout: CHECK_LIMIT_MS });
  return r.status === 0;
}
// The pass count a test runner printed (node --test's TAP or spec summary, or mocha's), or null.
export function passCount(out) {
  let last = null;
  for (const m of out.matchAll(/^\s*(?:#|\u2139)\s*pass\s+(\d+)\s*$/gm)) last = Number(m[1]);
  if (last === null) for (const m of out.matchAll(/^\s*(\d+) passing\b/gm)) last = Number(m[1]);
  return last;
}
// The rewrite control: every changed line of every changed file with one operand wrapped in parentheses. A file whose
// rewrite does not parse is rewritten line by line, keeping only the lines that still parse.
function rewriteControl(work, files, res) {
  let lines = 0, wrapped = 0;
  for (const f of files) {
    const target = path.join(work, f.file);
    const wraps = f.lines.map((l) => f.wrapLine(l)).filter(Boolean);
    lines += f.lines.length;
    if (!wraps.length) continue;
    fs.writeFileSync(target, applyInserts(f.src, wraps.flat()));
    if (parses(target)) { wrapped += wraps.length; continue; }
    let kept = [];
    for (const w of wraps) {
      fs.writeFileSync(target, applyInserts(f.src, [...kept, ...w]));
      if (parses(target)) { kept = [...kept, ...w]; wrapped++; }
    }
    fs.writeFileSync(target, applyInserts(f.src, kept));
  }
  res.rewrite = { lines, wrapped };
}

// ---------------------------------------------------------------------------------------------------------------------
// The run.

function blank() {
  return { version: GATE_VERSION, status: 'error', reason: '', base: null, mutants: 0, killed: 0, survived: null, invalid: 0, timeout: 0, ignored: 0,
    noise: 0, survivors: [], unmutated: [], ignores: [], files: [], timeoutMs: null, controls: [], rewrite: null, results: [] };
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
  const rc = control('rewrite', await runOnce(ctx, (work) => rewriteControl(work, p.files, res), res.timeoutMs));
  if (!rc.pass) return noise('the tests fail when the changed lines are rewritten to the same meaning, so they react to the source text');
  for (const m of p.mutants) {
    const text = applyEdits(m.src, m.edits);
    const entry = { file: m.file, line: m.line, operator: m.operator, outcome: 'invalid', ms: null };
    res.results.push(entry);
    const r1 = await runOnce(ctx, (work) => { const f = path.join(work, m.file); fs.writeFileSync(f, text); return parses(f); }, res.timeoutMs);
    if (r1.invalid) continue;
    entry.ms = r1.ms;
    if (r1.timedOut) { entry.outcome = 'timeout'; continue; }
    const r2 = await runOnce(ctx, (work) => { fs.writeFileSync(path.join(work, m.file), text); }, res.timeoutMs);
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
  try { changes = changedLines(root, res.base); } catch (e) { return fail(e.message); }
  if (scopes.length) {
    const tests = scopes.map(globMatcher);
    for (const f of [...changes.keys()]) if (!tests.some((t) => t(f))) changes.delete(f);
  }
  const p = plan(root, changes);
  Object.assign(res, { unmutated: p.unmutated, ignores: p.ignores, files: p.files.map(({ file }) => ({ file })) });
  if (!p.mutants.length) {
    res.status = 'no-mutants';
    res.reason = changes.size ? 'no changed line produced a mutant' : 'no line changed in the mutation set';
    return finish(res);
  }
  const before = treeHash(root);
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), RUN_PREFIX));
  fs.chmodSync(runDir, 0o700);
  const ctx = { runDir, cmd: test, rel: path.relative(root, fs.realpathSync(cwd)), name: path.basename(root), seq: 0, children: new Set() };
  ctx.seed = path.join(runDir, 'seed', ctx.name);
  const cleanup = () => { for (const c of ctx.children) killGroup(c); fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 3 }); };
  const onSignal = (sig) => { cleanup(); process.exit(sig === 'SIGINT' ? 130 : 143); };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    fs.mkdirSync(path.dirname(ctx.seed), { mode: 0o700 });
    seedCopy(root, ctx.seed);
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
