// SPDX-License-Identifier: Apache-2.0
// An init stopped after git init and before the vault's identity and first commit (the owner's first Windows install, where
// the old 20 s limit killed it) must not leave a vault that can never commit: the next init gives it both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { initVault } from '../src/engine/vault.mjs';

// no global or system git identity, as on a fresh Windows computer
const env = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(os.tmpdir(), 'memev-no-global-gitconfig'), GIT_TERMINAL_PROMPT: '0' };
const g = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, env: { ...process.env, ...env } });

test('a vault whose first init stopped after git init gets its identity and first commit on the next init', () => {
  const saved = {}; for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  try {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-ident-'));
    assert.equal(g(root, ['init', '-q', '-b', 'main']).status, 0); // what the stopped init left: .git, nothing else
    assert.equal(g(root, ['config', 'user.email']).stdout.trim(), '', 'the test needs a computer with no git identity');
    initVault(root, {});
    assert.equal(g(root, ['config', 'user.email']).stdout.trim(), 'memev@localhost');
    assert.equal(g(root, ['rev-parse', '--verify', '-q', 'HEAD']).status, 0, 'the vault has its first commit');
    fs.rmSync(root, { recursive: true, force: true });
  } finally { for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
});
