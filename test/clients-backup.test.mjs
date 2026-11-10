// SR-1.36 T6: every file connect changes is copied first and the copy is named in the result; disconnect gives back the
// exact bytes, or removes only what Memev created; a config that does not parse is never written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
import { clientDefs, connect, disconnect } from '../src/cli/clients.mjs';

const LAUNCHER = '/x/memev';
const fresh = () => { const h = tmpdir('backup-home-'); return { h, env: { HOME: h, XDG_CONFIG_HOME: path.join(h, '.config'), MEMEV_CONFIG_DIR: path.join(h, '.memev-config'), KIMI_CODE_HOME: '', VIBE_HOME: '' } }; };
const original = (f) => (f.endsWith('.json') || f.endsWith('.jsonc') ? '{\n  "theirs": {"keep": true}\n}\n' : f.endsWith('.toml') ? 'model = "theirs"\n' : f.endsWith('.yml') || f.endsWith('.yaml') ? 'theirs: true\n' : 'their own notes\n');

test('T6-c01: for every supported app, each backup holds the original bytes, disconnect restores them exactly, and files Memev created go without touching others', () => {
  const ids = clientDefs({ HOME: '/x' }, LAUNCHER, 'linux').map((d) => d.id);
  assert.ok(ids.length >= 30);
  for (const id of ids) {
    // the files existed: the copy is the original, and the original comes back byte for byte with its mode
    const a = fresh();
    const files = clientDefs(a.env, LAUNCHER, 'linux').find((d) => d.id === id).edits({}).map((e) => e.file);
    const before = new Map();
    for (const f of files) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, original(f), { mode: 0o600 }); before.set(f, fs.readFileSync(f)); }
    const r = connect(id, { env: a.env, launcher: LAUNCHER, platform: 'linux' });
    assert.ok(Array.isArray(r.backups), `${id}: the result names the backups`);
    assert.deepEqual(r.backups.map((b) => b.file).sort(), r.files.slice().sort(), `${id}: one backup for each file changed`);
    for (const b of r.backups) {
      assert.equal(b.existed, true);
      assert.ok(fs.readFileSync(b.backup).equals(before.get(b.file)), `${id}: ${b.file} backup equals the original`);
    }
    disconnect(id, { env: a.env, platform: 'linux' });
    for (const [f, bytes] of before) {
      assert.ok(fs.readFileSync(f).equals(bytes), `${id}: ${f} restored`);
      assert.equal(fs.statSync(f).mode & 0o777, 0o600, `${id}: ${f} keeps its mode`);
    }
    // the files did not exist: they are removed again, and a file beside them stays
    const b = fresh();
    const files2 = clientDefs(b.env, LAUNCHER, 'linux').find((d) => d.id === id).edits({}).map((e) => e.file);
    const keep = [];
    for (const f of files2) { fs.mkdirSync(path.dirname(f), { recursive: true }); const k = path.join(path.dirname(f), 'unrelated.txt'); fs.writeFileSync(k, 'mine'); keep.push(k); }
    const r2 = connect(id, { env: b.env, launcher: LAUNCHER, platform: 'linux' });
    for (const x of r2.backups) { assert.equal(x.existed, false, `${id}: ${x.file} was new`); assert.equal(x.backup, null); }
    disconnect(id, { env: b.env, platform: 'linux' });
    for (const f of files2) assert.equal(fs.existsSync(f), false, `${id}: ${f} removed`);
    for (const k of keep) assert.equal(fs.readFileSync(k, 'utf8'), 'mine', `${id}: ${k} untouched`);
  }
  // shared settings: taking one app away keeps what the other still reads
  const s = fresh();
  const toml = path.join(s.h, '.codex', 'config.toml'); fs.mkdirSync(path.dirname(toml), { recursive: true }); fs.writeFileSync(toml, 'model = "theirs"\n');
  connect('codex', { env: s.env, launcher: LAUNCHER, platform: 'linux' }); connect('chatgpt-desktop', { env: s.env, launcher: LAUNCHER, platform: 'linux' });
  disconnect('codex', { env: s.env, platform: 'linux' });
  assert.match(fs.readFileSync(toml, 'utf8'), /^\[mcp_servers\.memev\]/m, 'the ChatGPT app still reads the table');
  disconnect('chatgpt-desktop', { env: s.env, platform: 'linux' });
  assert.equal(fs.readFileSync(toml, 'utf8'), 'model = "theirs"\n');
});

test('T6-c02: a malformed JSON or TOML config is left byte for byte, and the result is failed with a reason', () => {
  const a = fresh();
  const j = path.join(a.h, '.claude.json'); fs.writeFileSync(j, '{ "half": ');
  const t = path.join(a.h, '.codex', 'config.toml'); fs.mkdirSync(path.dirname(t)); fs.writeFileSync(t, '[mcp_servers.other\ncommand = "x"\n');
  const bj = fs.readFileSync(j); const bt = fs.readFileSync(t);
  const r1 = connect('claude-code', { env: a.env, launcher: LAUNCHER, platform: 'linux' });
  const r2 = connect('codex', { env: a.env, launcher: LAUNCHER, platform: 'linux' });
  for (const [r, f] of [[r1, j], [r2, t]]) { assert.equal(r.failed, true); assert.ok(r.reason.includes(f), r.reason); }
  assert.match(r2.reason, /not valid TOML/);
  assert.ok(fs.readFileSync(j).equals(bj)); assert.ok(fs.readFileSync(t).equals(bt));
  assert.equal(fs.existsSync(path.join(a.h, '.codex', 'hooks.json')), false, 'nothing else of that app was written either');
  // the TOML check: valid files with multi-line values, arrays and inline tables pass; broken ones do not
  const ok = ['', '# c\n[a]\nk = "v"\n', 'k = """\nline\n"""\n', "k = '''\nx'''\n", 'arr = [\n  1,\n  2\n]\n', 'x = { a = 1 }\n[[t]]\n"q k" = 1\n', 'a.b = 1 # n\n'];
  const bad = ['[a\n', 'just words\n', 'k = """\nnever closed\n', 'arr = [\n 1,\n'];
  for (const text of ok) { const b = fresh(); const f = path.join(b.h, '.codex', 'config.toml'); fs.mkdirSync(path.dirname(f)); fs.writeFileSync(f, text); assert.notEqual(connect('codex', { env: b.env, launcher: LAUNCHER, platform: 'linux' }).failed, true, JSON.stringify(text)); }
  for (const text of bad) { const b = fresh(); const f = path.join(b.h, '.codex', 'config.toml'); fs.mkdirSync(path.dirname(f)); fs.writeFileSync(f, text); assert.equal(connect('codex', { env: b.env, launcher: LAUNCHER, platform: 'linux' }).failed, true, JSON.stringify(text)); }
  // and connect --json says failed, with the reason, and exits 1
  const sb = sandbox();
  fs.writeFileSync(path.join(sb.home, '.claude.json'), '{ "half": ');
  const out = sb.run(['connect', 'claude-code', '--json']);
  assert.equal(out.code, 1);
  const res = JSON.parse(out.out);
  assert.equal(res.apps[0].status, 'failed'); assert.match(res.apps[0].detail, /\.claude\.json/);
});
