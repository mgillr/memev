// MEM-047: Aider has no MCP and no hooks, so the hand-off is a conventions file that .aider.conf.yml
// reads at session start. `memev card --aider` writes the resume card there and adds it to the read list;
// running it twice is idempotent; `memev disconnect aider` takes both back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sandbox } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';
import { AIDER_CONVENTIONS, AIDER_CONF, aiderReadEntries, addAiderRead, removeAiderRead } from '../src/cli/clients.mjs';

function fresh() {
  const sb = sandbox();
  const r = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
  assert.equal(r.code, 0, r.err + r.out);
  return sb;
}
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);

test('MEM-047 AC01: card --aider writes the resume card to a conventions file and adds it to the .aider.conf.yml read list once', () => {
  const sb = fresh();
  try {
    const conv = AIDER_CONVENTIONS(sb.env);
    const conf = AIDER_CONF(sb.env);
    const r = sb.run(['card', '--aider']);
    assert.equal(r.code, 0, r.err + r.out);
    assert.ok(r.out.includes('Aider:'), `the command reports the hand-off:\n${r.out}`);
    const convText = read(conv);
    assert.ok(convText, 'the conventions file is written');
    assert.ok(convText.includes('[Memev resume card]'), `the conventions file carries the card:\n${convText}`);
    const confText = read(conf);
    assert.ok(confText, '.aider.conf.yml is written');
    assert.match(confText, /^read:\s*$/m, `the entry is under a read: key:\n${confText}`);
    assert.equal(aiderReadEntries(confText, conv).length, 1, `exactly one read entry points at the conventions file:\n${confText}`);
  } finally { sb.stop(); cleanup(); }
});

test('MEM-047 AC02: card --aider is idempotent and disconnect aider removes the entry and the conventions file', () => {
  const sb = fresh();
  try {
    const conv = AIDER_CONVENTIONS(sb.env);
    const conf = AIDER_CONF(sb.env);
    assert.equal(sb.run(['card', '--aider']).code, 0, 'first hand-off');
    assert.equal(sb.run(['card', '--aider']).code, 0, 'second hand-off');
    assert.equal(aiderReadEntries(read(conf), conv).length, 1, 'a second run adds no second read entry');
    const d = sb.run(['disconnect', 'aider']);
    assert.equal(d.code, 0, d.err + d.out);
    const after = read(conf);
    assert.equal(aiderReadEntries(after || '', conv).length, 0, `the read entry is removed:\n${after}`);
    assert.equal(fs.existsSync(conv), false, 'the Memev conventions file is removed');
  } finally { sb.stop(); cleanup(); }
});

test('MEM-047 AC01: a scalar read: value keeps the person\'s file when the conventions file is added and removed', () => {
  const sb = fresh();
  try {
    const conv = AIDER_CONVENTIONS(sb.env);
    const conf = AIDER_CONF(sb.env);
    fs.writeFileSync(conf, 'read: docs/STYLE.md\n');
    assert.equal(sb.run(['card', '--aider']).code, 0, 'hand-off onto a scalar read:');
    const after = read(conf);
    assert.equal((after.match(/^read:/gm) || []).length, 1, `one read: key after connect:\n${after}`);
    assert.ok(after.includes('docs/STYLE.md'), `the person's file is still listed after connect:\n${after}`);
    assert.equal(aiderReadEntries(after, conv).length, 1, `the conventions file is listed once:\n${after}`);
    assert.equal(sb.run(['disconnect', 'aider']).code, 0, 'disconnect');
    const back = read(conf);
    assert.equal((back.match(/^read:/gm) || []).length, 1, `one read: key after disconnect:\n${back}`);
    assert.ok(back.includes('docs/STYLE.md'), `the person's file is still listed after disconnect:\n${back}`);
    assert.equal(aiderReadEntries(back, conv).length, 0, `the conventions file is gone:\n${back}`);
  } finally { sb.stop(); cleanup(); }
});

test('MEM-047 AC01: a flow read: list keeps every file when the conventions file is added and removed', () => {
  const sb = fresh();
  try {
    const conv = AIDER_CONVENTIONS(sb.env);
    const conf = AIDER_CONF(sb.env);
    fs.writeFileSync(conf, 'read: [CONVENTIONS.md, docs/STYLE.md]\n');
    assert.equal(sb.run(['card', '--aider']).code, 0, 'hand-off onto a flow read:');
    const after = read(conf);
    assert.equal((after.match(/^read:/gm) || []).length, 1, `one read: key after connect:\n${after}`);
    assert.ok(after.includes('CONVENTIONS.md'), `the first file is still listed after connect:\n${after}`);
    assert.ok(after.includes('docs/STYLE.md'), `the second file is still listed after connect:\n${after}`);
    assert.equal(aiderReadEntries(after, conv).length, 1, `the conventions file is listed once:\n${after}`);
    assert.equal(sb.run(['disconnect', 'aider']).code, 0, 'disconnect');
    const back = read(conf);
    assert.equal((back.match(/^read:/gm) || []).length, 1, `one read: key after disconnect:\n${back}`);
    assert.ok(back.includes('CONVENTIONS.md'), `the first file is still listed after disconnect:\n${back}`);
    assert.ok(back.includes('docs/STYLE.md'), `the second file is still listed after disconnect:\n${back}`);
    assert.equal(aiderReadEntries(back, conv).length, 0, `the conventions file is gone:\n${back}`);
  } finally { sb.stop(); cleanup(); }
});

test('MEM-047 AC02: removeAiderRead takes out only the conventions file from scalar and flow read: forms', () => {
  const conv = '/cfg/aider-conventions.md';
  const scalar = addAiderRead('read: docs/STYLE.md\n', conv);
  assert.equal(removeAiderRead(scalar, conv), 'read:\n  - docs/STYLE.md\n', `scalar form keeps the person's file:\n${scalar}`);
  const flow = addAiderRead('read: [CONVENTIONS.md, docs/STYLE.md]\n', conv);
  assert.equal(removeAiderRead(flow, conv), 'read:\n  - CONVENTIONS.md\n  - docs/STYLE.md\n', `flow form keeps every file:\n${flow}`);
  assert.equal(removeAiderRead('read: docs/STYLE.md\n', conv), 'read: docs/STYLE.md\n', 'a scalar read: that holds no entry of ours is left alone');
  assert.equal(removeAiderRead('read: [CONVENTIONS.md]\n', conv), 'read: [CONVENTIONS.md]\n', 'a flow list that holds no entry of ours is left alone');
});

test('MEM-047 AC01: a read: list at column 0 or indented four spaces gains the conventions file at the same indent', () => {
  const conv = '/data/user/.config/memev/aider-conventions.md';
  const col0 = 'read:\n- CONVENTIONS.md\n';
  assert.equal(addAiderRead(col0, conv), `read:\n- CONVENTIONS.md\n- ${conv}\n`);
  assert.equal(aiderReadEntries(addAiderRead(col0, conv), conv).length, 1, 'listed once, so a second run adds nothing');
  const four = 'model: sonnet\nread:\n    - CONVENTIONS.md\n    - docs/STYLE.md\nedit-format: diff\n';
  assert.equal(addAiderRead(four, conv), `model: sonnet\nread:\n    - CONVENTIONS.md\n    - docs/STYLE.md\n    - ${conv}\nedit-format: diff\n`);
});

test('MEM-047 AC02: removing the conventions file from a column-0 or four-space read: list gives back the original', () => {
  const conv = '/data/user/.config/memev/aider-conventions.md';
  for (const text of ['read:\n- CONVENTIONS.md\n', 'model: sonnet\nread:\n    - CONVENTIONS.md\n    - docs/STYLE.md\nedit-format: diff\n']) {
    assert.equal(removeAiderRead(addAiderRead(text, conv), conv), text);
  }
});
