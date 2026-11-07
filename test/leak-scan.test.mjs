// The leak scan treats the SSH host of the port 443 fallback as a remote, not as an e-mail address.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const here = path.dirname(new URL(import.meta.url).pathname);
const scan = (text, env = process.env) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leakscan-'));
  try {
    fs.mkdirSync(path.join(dir, 'scripts'));
    for (const f of ['leak-scan.mjs', 'leak-denylist.json']) fs.copyFileSync(path.join(here, '..', 'scripts', f), path.join(dir, 'scripts', f));
    fs.writeFileSync(path.join(dir, 'remote.txt'), text);
    spawnSync('git', ['init', '-q'], { cwd: dir });
    const r = spawnSync(process.execPath, ['scripts/leak-scan.mjs'], { cwd: dir, encoding: 'utf8', env });
    return { code: r.status, out: r.stdout + r.stderr };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test('the leak scan accepts git@github.com and git@ssh.github.com as SSH remotes', () => {
  assert.equal(scan('git@github.com:owner/repo.git\n').code, 0);
  assert.equal(scan('ssh://git@ssh.github.com:443/owner/repo.git\n').code, 0);
});

test('the leak scan still flags a real e-mail address and a look-alike host', () => {
  // built at run time so this file does not itself hold an address
  assert.equal(scan(`contact ${['someone', 'gmail.com'].join('@')}\n`).code, 1);
  assert.equal(scan(`${['git', 'ssh.github.com.example.org'].join('@')}\n`).code, 1);
});

test('a denylisted word passes only as the owner in the public repository URL github.com/<owner>/memev', () => {
  // a made-up word stands in for a denylisted one, so this file holds no real denylisted word
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leakscan-words-'));
  try {
    const words = path.join(dir, 'words.txt');
    fs.writeFileSync(words, 'zebracorn\n');
    const env = { ...process.env, LEAK_DENYLIST: words };
    for (const ok of ['git clone https://github.com/zebracorn/memev.git\n', 'https://github.com/zebracorn/memev/releases/download/v1.2.3/memev-1.2.3.tgz\n',
      'see [GitHub Releases](https://github.com/ZebraCorn/memev/releases)\n', '  `https://github.com/zebracorn/memev.git`, then run\n']) {
      assert.equal(scan(ok, env).code, 0, ok);
    }
    for (const bad of ['zebracorn\n', 'https://github.com/zebracorn/memev-ops\n', 'https://github.com/zebracorn/other.git\n',
      'https://github.com/zebracorn/memev.git by zebracorn\n', 'https://gitlab.com/zebracorn/memev.git\n', 'https://github.com/zebracorn/memevx\n',
      '[link](https://github.com/zebracorn/memev]\n',
      // a host that only ends in github.com is another host
      'https://gist.github.com/zebracorn/memev\n', 'https://evilgithub.com/zebracorn/memev.git\n', 'https://not-github.com/zebracorn/memev/\n',
      'https://x_github.com/zebracorn/memev\n',
      // github.com inside a path, or with no scheme, is not the repository URL
      'https://evil.example/github.com/zebracorn/memev\n', '/tmp/go/src/github.com/zebracorn/memev/\n', 'github.com/zebracorn/memev\n',
      'git+https://github.com/zebracorn/memev.git\n',
      // inside another URL's query string
      'https://evil.example/?u=https://github.com/zebracorn/memev\n', 'https://evil.example/?a=1&u=https://github.com/zebracorn/memev.git\n']) {
      assert.equal(scan(bad, env).code, 1, bad);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the repository URL is not accepted in a commit message', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leakscan-history-'));
  try {
    fs.mkdirSync(path.join(dir, 'scripts'));
    for (const f of ['leak-scan.mjs', 'leak-denylist.json']) fs.copyFileSync(path.join(here, '..', 'scripts', f), path.join(dir, 'scripts', f));
    fs.writeFileSync(path.join(dir, 'words.txt'), 'zebracorn\n');
    fs.writeFileSync(path.join(dir, '.gitignore'), 'words.txt\n');
    const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8' });
    git('init', '-q'); git('add', '.'); git('commit', '-q', '-m', 'see https://github.com/zebracorn/memev.git');
    const r = spawnSync(process.execPath, ['scripts/leak-scan.mjs', '--history'], { cwd: dir, encoding: 'utf8', env: { ...process.env, LEAK_DENYLIST: path.join(dir, 'words.txt') } });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /commit [0-9a-f]{10}:1: denylisted word/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A merge commit's first line, "Merge pull request #N from <owner>/<branch>", passes when <owner> is the account in the origin
// remote's GitHub URL, and only then. The words are made up and given to the scan with LEAK_DENYLIST, so no real name is here.
const OWNER_WORD = 'ownerword';
const OTHER_WORD = 'otherword';
const history = (messages, origin) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leakscan-history-'));
  try {
    fs.mkdirSync(path.join(dir, 'scripts'));
    for (const f of ['leak-scan.mjs', 'leak-denylist.json']) fs.copyFileSync(path.join(here, '..', 'scripts', f), path.join(dir, 'scripts', f));
    const words = path.join(dir, '..', `${path.basename(dir)}-words.txt`);
    fs.writeFileSync(words, `${OWNER_WORD}\n${OTHER_WORD}\n`);
    const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8' });
    git('init', '-q');
    if (origin) git('remote', 'add', 'origin', origin);
    git('add', '-A');
    for (const m of messages) git('commit', '-q', '--allow-empty', '-m', m);
    const r = spawnSync(process.execPath, ['scripts/leak-scan.mjs', '--history'], { cwd: dir, encoding: 'utf8', env: { ...process.env, LEAK_DENYLIST: words } });
    fs.rmSync(words, { force: true });
    return { code: r.status, out: r.stdout + r.stderr };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};
const HTTPS = `https://github.com/${OWNER_WORD}/memev.git`;

test('a merge subject naming the repository owner passes, for each GitHub origin form', () => {
  const subject = `Merge pull request #7 from ${OWNER_WORD}/fix-branch`;
  for (const origin of [HTTPS, `https://github.com/${OWNER_WORD}/memev`, `git@github.com:${OWNER_WORD}/memev.git`, `ssh://git@ssh.github.com:443/${OWNER_WORD}/memev.git`]) {
    const r = history(['base', subject], origin);
    assert.equal(r.code, 0, `${origin}: ${r.out}`);
  }
});

test('another denylisted login in the owner slot still fails', () => {
  const r = history(['base', `Merge pull request #7 from ${OTHER_WORD}/fix-branch`], HTTPS);
  assert.equal(r.code, 1, r.out);
});

test('with no origin, or an origin off GitHub, the owner merge subject fails closed', () => {
  const subject = `Merge pull request #7 from ${OWNER_WORD}/fix-branch`;
  assert.equal(history(['base', subject], null).code, 1);
  assert.equal(history(['base', subject], `https://example.org/${OWNER_WORD}/memev.git`).code, 1);
});

test('the owner word is still found in the branch segment, the message body and a subject of another form', () => {
  assert.equal(history(['base', `Merge pull request #7 from ${OWNER_WORD}/${OWNER_WORD}-patch-1`], HTTPS).code, 1);
  assert.equal(history(['base', `Merge pull request #7 from ${OWNER_WORD}/fix-branch\n\nthanks ${OWNER_WORD}`], HTTPS).code, 1);
  assert.equal(history(['base', `Revert "Merge pull request #7 from ${OWNER_WORD}/fix-branch"`], HTTPS).code, 1);
  assert.equal(history(['base', `fix: a change by ${OWNER_WORD}`], HTTPS).code, 1);
});
