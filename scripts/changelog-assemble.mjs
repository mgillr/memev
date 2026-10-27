#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Changelog notes: each change adds changelog.d/<CONTRACT-ID>.md instead of editing CHANGELOG.md, so changes made side by
// side never conflict on it. This folds every note into CHANGELOG.md under "## Unreleased", in its Keep a Changelog
// section, and deletes the notes. --guard is the pull request check: CHANGELOG.md changes only by that fold or in a
// release that bumps the version in package.json.
// Usage: node scripts/changelog-assemble.mjs [--check] [--root DIR]
//        node scripts/changelog-assemble.mjs --guard <base-ref> [--root DIR]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SECTIONS = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];
// branches opened before the rule (bus decision MERGE-RACE-FIX, 27 Oct) keep their own CHANGELOG.md edit; drop each one
// once it has landed
export const EXEMPT = ['mem-064-checkout', 'mem-114-resume-card'];
const DIR = 'changelog.d';
const isNote = (f) => f.endsWith('.md') && f !== 'README.md';

/** A note: "### <Section>" headings, each followed by "- " bullets; a continuation line is indented. */
export function parseNote(text, name = 'note') {
  const out = new Map(); let cur = null;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const h = /^### (.+?)\s*$/.exec(line);
    if (h) {
      if (!SECTIONS.includes(h[1])) throw new Error(`${name}: unknown section "${h[1]}" (use one of ${SECTIONS.join(', ')})`);
      cur = h[1]; if (!out.has(cur)) out.set(cur, []); continue;
    }
    if (!line.trim()) continue;
    if (!cur) throw new Error(`${name}: text before the first "### <Section>" heading`);
    const bullets = out.get(cur);
    if (line.startsWith('- ')) bullets.push(line);
    else if (/^\s+\S/.test(line) && bullets.length) bullets[bullets.length - 1] += `\n${line}`;
    else throw new Error(`${name}: expected a "- " bullet under ### ${cur}`);
  }
  if (![...out.values()].some((b) => b.length)) throw new Error(`${name}: no bullet`);
  return out;
}

const trim = (ls) => { let a = 0, b = ls.length; while (a < b && !ls[a].trim()) a++; while (b > a && !ls[b - 1].trim()) b--; return ls.slice(a, b); };

/** CHANGELOG.md with the notes ([name, text] pairs, in order) added at the top of their sections under "## Unreleased". */
export function fold(changelog, notes) {
  if (!notes.length) return changelog;
  const lines = changelog.split('\n');
  const start = lines.findIndex((l) => l.trim() === '## Unreleased');
  if (start < 0) throw new Error('CHANGELOG.md has no "## Unreleased" heading');
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## ')); if (end < 0) end = lines.length;
  // the Unreleased body: lines before any section (older entries written without one), then its sections
  const loose = []; const sections = new Map(); let cur = null;
  for (const l of lines.slice(start + 1, end)) {
    const h = /^### (.+?)\s*$/.exec(l);
    if (h) { cur = h[1]; if (!sections.has(cur)) sections.set(cur, []); } else (cur ? sections.get(cur) : loose).push(l);
  }
  const add = new Map();
  for (const [name, text] of notes) for (const [s, bullets] of parseNote(text, name)) add.set(s, [...(add.get(s) || []), ...bullets]);
  for (const [s, bullets] of add) sections.set(s, [...bullets, ...trim(sections.get(s) || [])]);
  const order = [...SECTIONS.filter((s) => sections.has(s)), ...[...sections.keys()].filter((s) => !SECTIONS.includes(s))];
  const out = [...lines.slice(0, start + 1), ''];
  for (const s of order) out.push(`### ${s}`, '', ...trim(sections.get(s)), '');
  if (trim(loose).length) out.push(...trim(loose), '');
  return [...out, ...lines.slice(end)].join('\n');
}

const notesIn = (root) => {
  let files = []; try { files = fs.readdirSync(path.join(root, DIR)).filter(isNote).sort(); } catch {}
  return files.map((f) => [`${DIR}/${f}`, fs.readFileSync(path.join(root, DIR, f), 'utf8')]);
};

/** Fold the notes into CHANGELOG.md and delete them; with check, only parse them and say what would be added. */
export function assemble(root, { check = false } = {}) {
  const notes = notesIn(root);
  for (const [name, text] of notes) parseNote(text, name);
  if (!notes.length) return { notes: [], changed: false };
  const file = path.join(root, 'CHANGELOG.md');
  const next = fold(fs.readFileSync(file, 'utf8'), notes);
  if (!check) { fs.writeFileSync(file, next); for (const [name] of notes) fs.rmSync(path.join(root, name)); }
  return { notes: notes.map(([n]) => n), changed: true };
}

/** The pull request check. Returns the reason it passes; throws with the reason it fails. */
export function guard(root, base, { branch = process.env.GITHUB_HEAD_REF || '' } = {}) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (!branch) { try { branch = git('rev-parse', '--abbrev-ref', 'HEAD').trim(); } catch {} }
  const mb = git('merge-base', base, 'HEAD').trim();
  const changes = git('diff', '--name-status', '--no-renames', mb, 'HEAD').split('\n').filter(Boolean).map((l) => l.split('\t'));
  // every note this change adds or edits must parse
  for (const [st, f] of changes) if (st !== 'D' && f.startsWith(`${DIR}/`) && isNote(path.basename(f))) parseNote(fs.readFileSync(path.join(root, f), 'utf8'), f);
  if (!changes.some(([, f]) => f === 'CHANGELOG.md')) return 'CHANGELOG.md is not changed';
  if (EXEMPT.includes(branch)) return `${branch} was opened before the rule and keeps its CHANGELOG.md edit`;
  const version = (ref) => { try { return JSON.parse(git('show', `${ref}:package.json`)).version; } catch { return null; } };
  if (version(mb) !== version('HEAD')) return `a release: package.json goes from ${version(mb)} to ${version('HEAD')}`;
  const removed = changes.filter(([st, f]) => st === 'D' && f.startsWith(`${DIR}/`) && isNote(path.basename(f))).map(([, f]) => f).sort();
  const expected = fold(git('show', `${mb}:CHANGELOG.md`), removed.map((f) => [f, git('show', `${mb}:${f}`)]));
  if (removed.length && expected === fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')) return `the notes folded in: ${removed.join(', ')}`;
  throw new Error(`CHANGELOG.md is edited by hand. Add a note instead, changelog.d/<CONTRACT-ID>.md (see changelog.d/README.md); only node scripts/changelog-assemble.mjs or a release changes CHANGELOG.md.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const root = path.resolve(opt('--root') || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  try {
    if (args.includes('--guard')) {
      const base = opt('--guard'); if (!base) throw new Error('--guard <base-ref>');
      console.log(`changelog guard: ok (${guard(root, base)})`);
    } else {
      const check = args.includes('--check'); const r = assemble(root, { check });
      if (!r.notes.length) console.log('changelog: no notes in changelog.d/');
      else console.log(`changelog: ${check ? 'would fold' : 'folded'} ${r.notes.length} note(s): ${r.notes.join(', ')}`);
    }
  } catch (e) { console.error(`changelog: ${e.message}`); process.exit(1); }
}
