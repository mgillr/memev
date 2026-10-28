// MEM-047: Aider has no MCP and no hooks, so the hand-off is a conventions file that .aider.conf.yml
// reads at session start. `memev card --aider` writes the resume card there and adds it to the read list;
// running it twice is idempotent; `memev disconnect aider` takes both back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sandbox } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';
import { AIDER_CONVENTIONS, AIDER_CONF, aiderReadEntries } from '../src/cli/clients.mjs';

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
