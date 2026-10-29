// The version has one source: package.json. The engine reads it from there and the CLI prints it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { VERSION } from '../src/engine/vault.mjs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('REV-036 AC04: vault.mjs reads VERSION from package.json and memev --version prints the package version', () => {
  assert.equal(VERSION, pkg.version, 'the engine version is the package version');
  const src = fs.readFileSync(new URL('../src/engine/vault.mjs', import.meta.url), 'utf8');
  assert.ok(!src.includes(`'${pkg.version}'`) && !src.includes(`"${pkg.version}"`), 'no hardcoded version literal in vault.mjs');
  const r = spawnSync(process.execPath, [new URL('../bin/memev.mjs', import.meta.url).pathname, '--version'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), pkg.version, 'memev --version prints the package version');
});
