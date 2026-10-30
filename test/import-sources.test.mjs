// SPDX-License-Identifier: Apache-2.0
// Source-specific tests for the history import: project folders, AI history, export zips, secrets.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { tmpdir, cleanup, OWNER, newVault } from './helpers/tmp.mjs';
import { scanProject } from '../src/engine/importers/project.mjs';
import { scanAiHistory } from '../src/engine/importers/ai-history.mjs';
import { scanExport } from '../src/engine/importers/exports.mjs';
import { scanAll, existingHashes, dedup, runImport, listImports, undoImport } from '../src/engine/importers/core.mjs';
import { readZip } from '../src/engine/zip.mjs';

after(() => cleanup());

function makeZip(entries) {
  const parts = [];
  let offset = 0;
  const cdParts = [];
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name);
    const dataBuf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const crc = zlib.crc32(dataBuf);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(dataBuf.length, 18);
    lh.writeUInt32LE(dataBuf.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    parts.push(lh, nameBuf, dataBuf);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(dataBuf.length, 20);
    cd.writeUInt32LE(dataBuf.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    cdParts.push(cd, nameBuf);
    offset += 30 + nameBuf.length + dataBuf.length;
  }
  const cdBuf = Buffer.concat(cdParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, cdBuf, eocd]);
}

test('MEM-105 AC05: project folder scan finds README, docs, notes, git log; skips node_modules', () => {
  const dir = tmpdir('proj-');
  fs.writeFileSync(path.join(dir, 'README.md'), '# Test project\nSome content about the zephyrquokka plan.\n');
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(path.join(dir, 'docs', 'notes.md'), 'notes: zephyrquokka decisions\n');
  fs.mkdirSync(path.join(dir, 'node_modules', 'foo'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'foo', 'README.md'), 'should be skipped\n');
  fs.mkdirSync(path.join(dir, 'dist'));
  fs.writeFileSync(path.join(dir, 'dist', 'output.md'), 'should be skipped\n');
  const items = scanProject(dir);
  const titles = items.map((i) => i.title);
  assert.ok(titles.includes('README.md'), 'finds README.md');
  assert.ok(titles.includes('docs/notes.md'), 'finds docs/notes.md');
  assert.ok(!titles.some((t) => t.includes('node_modules')), 'skips node_modules');
  assert.ok(!titles.some((t) => t.includes('dist')), 'skips dist');
  const readme = items.find((i) => i.title === 'README.md');
  assert.ok(readme.content.includes('zephyrquokka'), 'README content is read');
  assert.equal(readme.skip, false, 'README is not skipped');
});

test('MEM-105 AC05: project folder scan includes git log subjects when in a git repo', () => {
  const dir = tmpdir('gitproj-');
  fs.writeFileSync(path.join(dir, 'README.md'), '# Git project\n');
  execFileSync('git', ['init'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@example.invalid'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Git project v2\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'initial commit'], { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Git project v3\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'second commit'], { cwd: dir, stdio: 'pipe' });
  const items = scanProject(dir);
  const gitItem = items.find((i) => i.title === 'git log (recent subjects)');
  assert.ok(gitItem, 'git log item present');
  assert.ok(gitItem.content.includes('initial commit'), 'has first subject');
  assert.ok(gitItem.content.includes('second commit'), 'has second subject');
  assert.ok(!gitItem.content.includes('diff'), 'no diffs');
});

test('MEM-105 AC06: AI history scan finds CLAUDE.md, AGENTS.md, Claude Code and Cursor files in a fake home', () => {
  const home = tmpdir('home-');
  const cwd = tmpdir('cwd-');
  fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), '# Project rules\nAlways use zephyrquokka patterns.\n');
  fs.writeFileSync(path.join(cwd, 'AGENTS.md'), '# Agent rules\nFollow the zephyrquokka guide.\n');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), '# Global Claude rules\nRemember zephyrquokka conventions.\n');
  fs.mkdirSync(path.join(home, '.claude', 'projects', 'myproj'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'projects', 'myproj', 'memory.md'), 'Project memory: zephyrquokka state.\n');
  fs.mkdirSync(path.join(home, '.cursor', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cursor', 'rules', 'style.md'), 'Cursor rule: zephyrquokka style.\n');
  const before = {};
  for (const f of [path.join(cwd, 'CLAUDE.md'), path.join(cwd, 'AGENTS.md'), path.join(home, '.claude', 'CLAUDE.md'), path.join(home, '.claude', 'projects', 'myproj', 'memory.md'), path.join(home, '.cursor', 'rules', 'style.md')]) {
    before[f] = fs.readFileSync(f);
  }
  const items = scanAiHistory({ cwd, home });
  assert.ok(items.length >= 3, `found ${items.length} items, expected at least 3`);
  const sources = new Set(items.map((i) => i.source));
  assert.ok(sources.has('ai-history'), 'source tag is ai-history');
  const titles = items.map((i) => i.title);
  assert.ok(titles.includes('CLAUDE.md'), 'found CLAUDE.md');
  assert.ok(titles.includes('AGENTS.md'), 'found AGENTS.md');
  for (const f of Object.keys(before)) {
    assert.deepEqual(fs.readFileSync(f), before[f], `${path.basename(f)} unchanged`);
  }
});

test('MEM-105 AC07: export zip is read and conversations become tagged items; corrupt zip is reported', () => {
  const dir = tmpdir('export-');
  const conv = JSON.stringify({
    conversations: [
      { role: 'user', content: 'Tell me about zephyrquokka planning' },
      { role: 'assistant', content: 'Zephyrquokka is a planning tool.' }
    ]
  });
  const zipBuf = makeZip([{ name: 'conversations.json', data: conv }]);
  const zipFile = path.join(dir, 'export.zip');
  fs.writeFileSync(zipFile, zipBuf);
  const items = scanExport(zipFile);
  assert.equal(items.length, 1, 'one item from the zip');
  assert.equal(items[0].source, 'export', 'source tag is export');
  assert.ok(items[0].content.includes('zephyrquokka'), 'conversation text extracted');
  assert.ok(items[0].content.includes('[user]'), 'role tagged');
  assert.ok(items[0].content.includes('[assistant]'), 'assistant role tagged');
  const corruptFile = path.join(dir, 'corrupt.zip');
  fs.writeFileSync(corruptFile, Buffer.from('this is not a zip file'));
  const corruptItems = scanExport(corruptFile);
  assert.equal(corruptItems.length, 0, 'corrupt zip produces no items');
});

test('MEM-105 AC08: secrets are skipped by name only in the preview', () => {
  const dir = tmpdir('secrets-');
  fs.writeFileSync(path.join(dir, 'README.md'), '# Safe content\n');
  fs.writeFileSync(path.join(dir, '.env'), 'API_KEY=sk-live-abcdefghijklmnop1234567890\n');
  fs.writeFileSync(path.join(dir, 'deploy.key'), 'dummy-key-material\n');
  fs.writeFileSync(path.join(dir, 'credentials.json'), '{"token": "ghp_abcdefghijklmnopqrst"}\n');
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(path.join(dir, 'docs', 'leaky.md'), 'The token is sk-live-abcdefghijklmnop1234567890 here\n');
  const items = scanProject(dir);
  const skipped = items.filter((i) => i.skip);
  const skippedTitles = skipped.map((i) => i.title);
  assert.ok(skippedTitles.includes('.env'), '.env is skipped');
  assert.ok(skippedTitles.includes('deploy.key'), 'deploy.key is skipped');
  assert.ok(skippedTitles.includes('credentials.json'), 'credentials.json is skipped');
  assert.ok(skippedTitles.includes('docs/leaky.md'), 'leaky.md is skipped');
  for (const s of skipped) {
    assert.equal(s.content, null, `${s.title} has no content`);
  }
  const safe = items.find((i) => i.title === 'README.md');
  assert.equal(safe.skip, false, 'README is not skipped');
});
