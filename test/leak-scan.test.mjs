// The leak scan treats the SSH host of the port 443 fallback as a remote, not as an e-mail address.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const here = path.dirname(new URL(import.meta.url).pathname);
const scan = (text) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leakscan-'));
  try {
    fs.mkdirSync(path.join(dir, 'scripts'));
    for (const f of ['leak-scan.mjs', 'leak-denylist.json']) fs.copyFileSync(path.join(here, '..', 'scripts', f), path.join(dir, 'scripts', f));
    fs.writeFileSync(path.join(dir, 'remote.txt'), text);
    spawnSync('git', ['init', '-q'], { cwd: dir });
    const r = spawnSync(process.execPath, ['scripts/leak-scan.mjs'], { cwd: dir, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test('the leak scan accepts git@github.com and git@ssh.github.com as SSH remotes', () => {
  assert.equal(scan('git@github.com:owner/repo.git\n').code, 0);
  assert.equal(scan('ssh://git@ssh.github.com:443/owner/repo.git\n').code, 0);
});

test('the leak scan still flags a real e-mail address and a look-alike host', () => {
  assert.equal(scan('contact someone@gmail.com\n').code, 1);
  assert.equal(scan('git@ssh.github.com.evil.example\n').code, 1);
});
