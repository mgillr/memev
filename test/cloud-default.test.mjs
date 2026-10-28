// Cloud access for cloud AI apps: off by default on a fresh install, offered once on a terminal, and the
// checklist says in one line how to switch it on and what would be shared.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { sandbox } from './helpers/cli.mjs';
import { tmpdir, cleanup, PKG } from './helpers/tmp.mjs';
import { initVault } from '../src/engine/vault.mjs';
import { CLOUD_QUESTION, askCloudOnce } from '../src/cli/onboarding.mjs';
after(cleanup);

const answers = (text) => Object.assign(Readable.from([text]), { isTTY: false });
const sink = () => { const s = []; return { write: (c) => s.push(String(c)), text: () => s.join('') }; };
const cfgOf = (root) => JSON.parse(fs.readFileSync(path.join(root, '.memev', 'config.json'), 'utf8'));

test('MEM-054 AC01: a fresh init without MEMEV_NO_TUNNEL leaves remote.enabled false', () => {
  const sb = sandbox();
  try {
    const r = sb.run(['init', '--port', String(sb.port)], { extraEnv: { MEMEV_NO_TUNNEL: '' } });
    assert.equal(r.code, 0, r.out + r.err);
    assert.equal(cfgOf(sb.root).remote.enabled, false, 'remote access is off after a fresh init');
  } finally { sb.stop(); cleanup(); }
});

test('MEM-054 AC02: a fresh install downloads no tunnel binary', () => {
  const sb = sandbox();
  try {
    const r = sb.run(['init', '--port', String(sb.port)], { extraEnv: { MEMEV_NO_TUNNEL: '', MEMEV_NO_DOWNLOAD: '' } });
    assert.equal(r.code, 0, r.out + r.err);
    const tools = path.join(sb.env.MEMEV_CONFIG_DIR, 'tools');
    assert.equal(fs.existsSync(tools), false, 'no tools directory, so no tunnel binary was downloaded');
  } finally { sb.stop(); cleanup(); }
});

test('MEM-054 AC03: the checklist offers memev cloud on in one line that says what is shared', () => {
  const sb = sandbox();
  try {
    const r = sb.run(['init', '--port', String(sb.port)]);
    assert.equal(r.code, 0, r.out + r.err);
    const lines = r.out.split('\n').filter((l) => l.includes('Cloud AI apps'));
    assert.equal(lines.length, 1, r.out);
    assert.match(lines[0], /memev cloud on/);
    assert.match(lines[0], /recall/);
    assert.match(lines[0], /ChatGPT|claude\.ai/);
  } finally { sb.stop(); cleanup(); }
});

test('init --local-only: the cloud question is not asked and remote stays off', async () => {
  const sb = sandbox();
  try {
    const r = sb.run(['init', '--port', String(sb.port), '--local-only'], { input: 'y\n' });
    assert.equal(r.code, 0, r.out + r.err);
    assert.doesNotMatch(r.out, /Use your memory from ChatGPT or claude\.ai\? \[y\/N\]/);
    const cfg = cfgOf(sb.root);
    assert.equal(cfg.remote.enabled, false, 'remote stays off');
    assert.equal(cfg.remote.asked, true, 'the answer is kept, so the question never comes back');
    // on a terminal the question is still not asked, and a yes cannot turn remote on
    const out = sink();
    assert.equal(await askCloudOnce({ root: sb.root, ask: true, input: answers('y\n'), output: out }), null);
    assert.equal(out.text(), '');
    assert.equal(cfgOf(sb.root).remote.enabled, false);
  } finally { sb.stop(); cleanup(); }
});

test('init --org: the cloud question is not asked and remote stays off', async () => {
  const sb = sandbox();
  try {
    const r = sb.run(['init', '--port', String(sb.port), '--org'], { input: 'y\n' });
    assert.equal(r.code, 0, r.out + r.err);
    assert.doesNotMatch(r.out, /Use your memory from ChatGPT or claude\.ai\? \[y\/N\]/);
    const cfg = cfgOf(sb.root);
    assert.equal(cfg.profile, 'org');
    assert.equal(cfg.remote.enabled, false, 'remote stays off');
    assert.equal(cfg.remote.asked, true, 'the answer is kept, so the question never comes back');
    // on a terminal the question is still not asked, and a yes cannot turn remote on
    const out = sink();
    assert.equal(await askCloudOnce({ root: sb.root, ask: true, input: answers('y\n'), output: out }), null);
    assert.equal(out.text(), '');
    assert.equal(cfgOf(sb.root).remote.enabled, false);
  } finally { sb.stop(); cleanup(); }
});

test('the terminal question asks once: yes turns remote access on, and it is never asked again', async () => {
  const root = path.join(tmpdir(), 'vault');
  initVault(root, { template: path.join(PKG, 'templates', 'vault') });
  const out = sink();
  assert.equal(cfgOf(root).remote.enabled, false);
  assert.equal(await askCloudOnce({ root, ask: true, input: answers('y\n'), output: out }), true);
  assert.match(out.text(), /Use your memory from ChatGPT or claude\.ai\? \[y\/N\]/);
  assert.equal(cfgOf(root).remote.enabled, true, 'a yes turns remote access on');
  assert.equal(cfgOf(root).remote.asked, true);
  assert.equal(await askCloudOnce({ root, ask: true, input: answers('y\n'), output: sink() }), null, 'not asked again');
});

test('the terminal question: no and Enter keep remote access off, and it is never asked again', async () => {
  const root = path.join(tmpdir(), 'vault');
  initVault(root, { template: path.join(PKG, 'templates', 'vault') });
  assert.equal(await askCloudOnce({ root, ask: true, input: answers('n\n'), output: sink() }), false);
  assert.equal(cfgOf(root).remote.enabled, false);
  assert.equal(cfgOf(root).remote.asked, true);
  assert.equal(await askCloudOnce({ root, ask: true, input: answers('\n'), output: sink() }), null, 'not asked again');
  // with no terminal the question is not asked at all, and the default stays off
  const root2 = path.join(tmpdir(), 'vault');
  initVault(root2, { template: path.join(PKG, 'templates', 'vault') });
  assert.equal(await askCloudOnce({ root: root2, input: answers('y\n'), output: sink() }), null);
  assert.equal(cfgOf(root2).remote.enabled, false);
  assert.equal(cfgOf(root2).remote.asked, undefined);
});

test('the question text names what would be shared', () => {
  assert.match(CLOUD_QUESTION, /what recall returns/);
  assert.match(CLOUD_QUESTION, /memev cloud off/);
});
