// Apps Memev detects but does not support yet are listed as found, not supported yet, and their files are never changed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';
import { detect, connectAll } from '../src/cli/clients.mjs';

after(() => cleanup());

const UNSUPPORTED = { cline: '.config/cline', continue: '.continue', goose: '.config/goose' };
const NAMES = { cline: 'Cline', continue: 'Continue', goose: 'Goose' };

test('MEM-046 AC01: with fake config dirs for Cline, Continue and Goose, the checklist lists each as found but not supported yet', () => {
  const sb = sandbox();
  try {
    for (const rel of Object.values(UNSUPPORTED)) fs.mkdirSync(path.join(sb.home, rel), { recursive: true });
    const r = sb.run(['init', '--port', String(sb.port), '--local-only']);
    assert.equal(r.code, 0, r.out + r.err);
    for (const [id, name] of Object.entries(NAMES)) {
      assert.match(r.out, new RegExp(`${name}: found, not supported yet`), `${name} is listed as found, not supported yet\n${r.out}`);
    }
    assert.match(r.out, /docs\/CLIENTS\.md/, 'the line points to docs/CLIENTS.md');
    // the found-but-unsupported apps are not treated as connected or as steps that need the user
    assert.equal(r.out.includes('Cline: MCP'), false, r.out);
    assert.equal(r.out.includes('memev connect cline'), false, r.out);
  } finally { sb.stop(); }
});

test('MEM-046 AC02: no config file of an unsupported app is modified', () => {
  const sb = sandbox();
  try {
    const files = {};
    for (const [id, rel] of Object.entries(UNSUPPORTED)) {
      const f = path.join(sb.home, rel, 'settings.json');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify({ app: id, theme: 'dark', key: 'value' }, null, 2));
      files[id] = f;
    }
    const before = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, fs.readFileSync(f)]));
    const r = sb.run(['init', '--port', String(sb.port), '--local-only']);
    assert.equal(r.code, 0, r.out + r.err);
    const after = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, fs.readFileSync(f)]));
    assert.deepEqual(after, before, 'the config files of unsupported apps are byte for byte the same');
    const st = fs.existsSync(path.join(sb.env.MEMEV_CONFIG_DIR, 'clients-state.json'))
      ? JSON.parse(fs.readFileSync(path.join(sb.env.MEMEV_CONFIG_DIR, 'clients-state.json'), 'utf8'))
      : { connected: {}, files: {} };
    for (const id of Object.keys(UNSUPPORTED)) {
      assert.equal(st.connected[id], undefined, `${id} is not connected`);
      assert.equal(Object.keys(st.files).some((f) => f.startsWith(path.join(sb.home, UNSUPPORTED[id]))), false, `${id} has no file under Memev's management`);
    }
  } finally { sb.stop(); }
});

test('detect marks a found unsupported app with supported false, and connectAll leaves it out', () => {
  const sb = sandbox();
  try {
    fs.mkdirSync(path.join(sb.home, '.config', 'cline'), { recursive: true });
    fs.mkdirSync(path.join(sb.home, '.claude'), { recursive: true });
    const d = detect(sb.env, '/x/memev');
    const cline = d.find((c) => c.id === 'cline');
    assert.equal(cline.found, true);
    assert.equal(cline.supported, false);
    const claude = d.find((c) => c.id === 'claude-code');
    assert.equal(claude.found, true);
    assert.equal(claude.supported, true);
    const res = connectAll({ env: sb.env, launcher: '/x/memev' });
    assert.deepEqual(res.map((x) => x.id), ['claude-code'], 'connectAll connects the supported app and leaves the unsupported one alone');
  } finally { sb.stop(); }
});

test('memev clients lists a found unsupported app as found, not supported yet', () => {
  const sb = sandbox();
  try {
    fs.mkdirSync(path.join(sb.home, '.config', 'goose'), { recursive: true });
    const i = sb.run(['init', '--port', String(sb.port), '--local-only']);
    assert.equal(i.code, 0, i.out + i.err);
    const c = sb.run(['clients']);
    assert.equal(c.code, 0, c.out + c.err);
    assert.match(c.out, /Goose\s+found, not supported yet/, c.out);
  } finally { sb.stop(); }
});

test('memev connect for a found unsupported app says found, not supported yet and changes nothing', () => {
  const sb = sandbox();
  try {
    const f = path.join(sb.home, '.config', 'amp', 'config.json');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, '{"theme":"dark"}');
    const before = fs.readFileSync(f);
    const i = sb.run(['init', '--port', String(sb.port), '--local-only']);
    assert.equal(i.code, 0, i.out + i.err);
    const c = sb.run(['connect', 'amp']);
    assert.equal(c.code, 0, c.out + c.err);
    assert.match(c.out, /Amp: found, not supported yet/, c.out);
    assert.ok(fs.readFileSync(f).equals(before), 'the amp config is unchanged');
  } finally { sb.stop(); }
});
