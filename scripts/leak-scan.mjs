#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Leak scan: fails when a tracked file or a commit message holds a denylisted word, a personal
// e-mail address, a public IP address or a personal home path. The denylist holds only SHA-256
// hashes. Extra words can be checked locally with LEAK_DENYLIST=<file of words> (never committed).
// Usage: node scripts/leak-scan.mjs [--history]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const h = (s) => crypto.createHash('sha256').update(s).digest('hex');
const deny = new Set(JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'leak-denylist.json'), 'utf8')).sha256);
if (process.env.LEAK_DENYLIST) for (const w of fs.readFileSync(process.env.LEAK_DENYLIST, 'utf8').split(/\s+/).filter(Boolean)) deny.add(h(w.toLowerCase()));

// Files whose content is fixed by a licence (attribution must be kept verbatim) or by an approval record.
const EXEMPT = [/^vendor\/[^/]+\/(NOTICE|LICENSE)$/, /^NOTICE$/];
const ALLOW_LINE = [{ file: /^docs\/READINESS-REVIEW\.md$/, line: /^Approved-By: \S+ \(\d{4}-\d{2}-\d{2}\)$/ }];
const SELF = new Set(['scripts/leak-denylist.json']);
// Commit messages already on main that can't be changed, because history is never rewritten. Only the
// listed line of each is skipped; the rest of the message is still scanned. Merge pull requests with
// an explicit subject (gh pr merge --subject) so this list doesn't grow.
const ALLOW_COMMIT_LINE = new Map([['e5297abf3dd51b953cb0a6829b21927fc56567d4', 1]]); // GitHub's default merge subject for PR 7
const OK_EMAIL = /(@(example\.(com|org|net)|[a-z0-9-]+\.invalid|localhost|users\.noreply\.github\.com)|^git@github\.com)$/i; // git@github.com is an SSH remote, not an address
const OK_IP = (ip) => /^(127\.|0\.0\.0\.0$|10\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|255\.)/.test(ip) || ip.split('.').some((x) => Number(x) > 255);
const OK_HOME = new Set(['you', 'me', 'user', 'username', 'name', 'runner', 'example', 'alice', 'bob', 'node', '<name>', '<user>', 'ubuntu', 'shared', 'memev']);

const ROOT_HOME = new RegExp(`(^|[\\s"'(])/${'root'}/`);
const findings = [];
function scanText(where, text, file = '') {
  if (EXEMPT.some((re) => re.test(file)) || SELF.has(file)) return;
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (ALLOW_LINE.some((a) => a.file.test(file) && a.line.test(line))) return;
    const lower = line.toLowerCase();
    const words = new Set();
    for (const w of lower.split(/[^a-z0-9@._+-]+/)) { if (!w) continue; words.add(w); words.add(w.replace(/^[._-]+|[._-]+$/g, '')); for (const p of w.split(/[._@+-]+/)) if (p) words.add(p); }
    for (const w of lower.split(/[^a-z0-9]+/)) if (w) words.add(w);
    for (const w of words) if (deny.has(h(w))) findings.push(`${where}:${i + 1}: denylisted word (sha256 ${h(w).slice(0, 12)})`);
    for (const m of line.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) if (!OK_EMAIL.test(m[0])) findings.push(`${where}:${i + 1}: e-mail address`);
    for (const m of line.matchAll(/(?<![\d.])(\d{1,3}(?:\.\d{1,3}){3})(?![\d.])/g)) if (!OK_IP(m[1])) findings.push(`${where}:${i + 1}: IP address ${m[1].replace(/\.\d+\.\d+$/, '.x.x')}`);
    for (const m of line.matchAll(/(?:\/Users\/|\/home\/)([A-Za-z0-9._-]+)/g)) if (!OK_HOME.has(m[1].toLowerCase())) findings.push(`${where}:${i + 1}: personal home path`);
    if (ROOT_HOME.test(line)) findings.push(`${where}:${i + 1}: root home path`);
    if (/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(line)) findings.push(`${where}:${i + 1}: private key`);
  });
}

const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
for (const f of files) {
  let buf; try { buf = fs.readFileSync(path.join(root, f)); } catch { continue; }
  if (buf.includes(0)) continue; // binary
  scanText(f, buf.toString('utf8'), f);
  scanText(`(path) ${f}`, f, '');
}
if (process.argv.includes('--history')) {
  const log = execFileSync('git', ['log', '--format=%H%x00%B%x00'], { cwd: root, encoding: 'utf8' }).split('\0');
  for (let i = 0; i + 1 < log.length; i += 2) {
    const sha = log[i].trim(); const lines = log[i + 1].split('\n'); const skip = ALLOW_COMMIT_LINE.get(sha);
    if (skip) lines[skip - 1] = '';
    scanText(`commit ${sha.slice(0, 10)}`, lines.join('\n'));
  }
}
if (findings.length) { console.error(`leak scan: ${findings.length} finding(s)`); for (const f of findings) console.error(`  ${f}`); process.exit(1); }
console.log(`leak scan: clean (${files.length} files${process.argv.includes('--history') ? ' and every commit message' : ''}, ${deny.size} denylisted words)`);
