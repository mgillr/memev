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
const ALLOW_COMMIT_LINE = new Map([['e5297abf3dd51b953cb0a6829b21927fc56567d4', 1], ['6f21fc3a96bde24ef6e4f36e4018d5c997fcf06f', 1], ['796af33b489ac1683178ac3bed0ff90beb8d6e3f', 9], ['67bec9dea1c2122b45da0a6c440fda29f18cd792', 1], ['3989c80bea615381947758e0ab1d28dfe18f115b', 1], ['4b8b99c64f87d389f8ceb54e48e4c0641de553b1', 1], ['2dd634a5a0cdfca98ce98f9295ba662a0f3ecce2', 1], ['c228ec9dd34e04a8e7ba47acb308aaea8823d6bc', 1], ['79ffa67d1633ca5df63084b1892c67a90e5a7a7a', 1], ['65c1b28b4af268e380956d84da8abf886fa891e4', 1]]); // GitHub's default merge subjects for PR 7 and PR 55; the sign-off line of the 28 Oct docs hotfix; the default merge subject of PR 323, which I merged without an explicit subject; the default merge subject of PR 343, merged the same way; the default merge subject of PR 340, merged the same way; four GitHub-generated merge subjects from the 2 November 2026 product-positioning merges
const OK_EMAIL = /(@(example\.(com|org|net)|[a-z0-9-]+\.invalid|localhost|users\.noreply\.github\.com)|^git@(ssh\.)?github\.com)$/i; // git@github.com and git@ssh.github.com (the port 443 SSH host) are SSH remotes, not addresses
const OK_IP = (ip) => /^(127\.|0\.0\.0\.0$|10\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|255\.)/.test(ip) || ip.split('.').some((x) => Number(x) > 255);
const OK_HOME = new Set(['you', 'me', 'user', 'username', 'name', 'runner', 'example', 'alice', 'bob', 'node', '<name>', '<user>', 'ubuntu', 'shared', 'memev']);

// The public repository URL https://github.com/<owner>/memev: the scheme must sit right before the host,
// so a host ending in github.com, github.com inside a path, or a bare github.com/<owner>/memev is not it.
// Only the start of a line, a space, a quote, a backtick or an opening bracket may come before it, so the
// URL inside another URL (after = or ?) is not it either.
const REPO_URL = /(?<=^|[\s"'`(<\[])https:\/\/github\.com\/([a-z0-9-]+)\/memev(?=\.git(?![a-z0-9])|[/\s"'`)>]|$)/g;
const ROOT_HOME = new RegExp(`(^|[\\s"'(])/${'root'}/`);
// The account that owns this repository, read at run time from the origin remote's GitHub URL for memev and never written here. It
// is null when there is no origin, or the origin is not github.com/<owner>/memev; then nothing is blanked and the scan fails closed.
// The origin is the clone's own config, so this only decides what a clone accepts in its own history; CI checks out from GitHub.
function repoOwner() {
  let url = '';
  try { url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
  const m = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@(?:ssh\.)?github\.com(?::443)?\/)([A-Za-z0-9-]+)\/memev(?:\.git)?\/?$/i.exec(url);
  return m ? m[1].toLowerCase() : null;
}
const OWNER = repoOwner();
// GitHub writes a merge commit's first line as "Merge pull request #N from <owner>/<branch>". When <owner> is this repository's
// owner, that one segment of that one line is blanked, so a merge made in the web UI with GitHub's default subject passes. Any other
// login in that slot, the branch segment, the same word anywhere else in the message, and a line of any other form are still found.
const MERGE_SUBJECT = /^(Merge pull request #\d+ from )([A-Za-z0-9-]+)(\/\S+)$/;
const findings = [];
function scanText(where, text, file = '', isCommit = false) {
  if (EXEMPT.some((re) => re.test(file)) || SELF.has(file)) return;
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (ALLOW_LINE.some((a) => a.file.test(file) && a.line.test(line))) return;
    // The repository is public at github.com/<owner>/memev, so its owner's name in that exact URL, in a tracked file, is not a
    // leak. Only that owner segment is blanked, and only when the path is this repository (memev, then .git, a slash, a quote, a
    // closing parenthesis, an angle bracket, a space or the end of the line), and only when the host is github.com itself: the
    // character before it is not a letter, a digit, a dot or a hyphen, so gist.github.com and a look-alike host do not count. The
    // same word anywhere else on the line, in another repository's URL, on another host, in a file path or in a commit message is
    // still found.
    const merge = isCommit && i === 0 && OWNER ? MERGE_SUBJECT.exec(line) : null;
    const lower = file ? line.toLowerCase().replace(REPO_URL, (m, owner) => (deny.has(h(owner)) ? m.replace(`/${owner}/`, '//') : m))
      : merge && merge[2].toLowerCase() === OWNER ? `${merge[1]}${merge[3]}`.toLowerCase() : line.toLowerCase();
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
    scanText(`commit ${sha.slice(0, 10)}`, lines.join('\n'), '', true);
  }
}
if (findings.length) { console.error(`leak scan: ${findings.length} finding(s)`); for (const f of findings) console.error(`  ${f}`); process.exit(1); }
console.log(`leak scan: clean (${files.length} files${process.argv.includes('--history') ? ' and every commit message' : ''}, ${deny.size} denylisted words)`);
