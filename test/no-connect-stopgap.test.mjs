// Issue 284: memev init --no-connect was undone by the daemon's background connect a few seconds after it started, which
// edited the config file of every AI app it found. --no-connect now turns the background connect off, the daemon reads that
// from disk on every run, and memev connect with no app turns it back on; memev connect <app> connects one app and leaves it off.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';

after(cleanup);
const BG = { MEMEV_NO_BACKGROUND: '0' }; // the background jobs run, as on a real install
const jobs = (sb) => { try { return JSON.parse(fs.readFileSync(path.join(sb.root, '.memev', 'jobs.json'), 'utf8')); } catch { return {}; } };
const cfg = (sb) => JSON.parse(fs.readFileSync(path.join(sb.root, '.memev', 'config.json'), 'utf8'));
// wait for the daemon's own record of the background connect run (5 s after start), not a fixed time
async function redetectRun(sb, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const r = jobs(sb).redetect; if (r) return r; await new Promise((res) => setTimeout(res, 200)); }
  throw new Error('the background connect never ran');
}

test('issue 284: after memev init --no-connect the background connect leaves a detected app untouched', async () => {
  const sb = sandbox();
  const codex = path.join(sb.home, '.codex'); fs.mkdirSync(codex, { recursive: true }); // Codex is detected by this folder alone
  try {
    const r = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect'], { extraEnv: BG });
    assert.equal(r.code, 0, r.out + r.err);
    assert.equal(cfg(sb).clients?.auto_connect, false, 'init --no-connect records that the background connect is off');
    const run = await redetectRun(sb);
    assert.equal(run.skipped, 'auto_connect is off', `the background connect ran anyway: ${JSON.stringify(run)}`);
    assert.deepEqual(fs.readdirSync(codex), [], 'nothing was written into the app\'s folder');
  } finally { sb.stop(); }
});

test('issue 284: memev connect <app> connects one app and keeps the background connect off; memev connect turns it back on', async () => {
  const sb = sandbox();
  fs.mkdirSync(path.join(sb.home, '.codex'), { recursive: true });
  fs.mkdirSync(path.join(sb.home, '.gemini'), { recursive: true });
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
    const one = sb.run(['connect', 'codex']);
    assert.equal(one.code, 0, one.out + one.err);
    assert.equal(cfg(sb).clients?.auto_connect, false, 'one yes connects one app; the background connect stays off');
    assert.deepEqual(fs.readdirSync(path.join(sb.home, '.gemini')), [], 'the other app is untouched');
    const all = sb.run(['connect']);
    assert.equal(all.code, 0, all.out + all.err);
    assert.equal(cfg(sb).clients?.auto_connect, undefined, 'connecting every app turns the background connect back on');
    assert.match(all.out + all.err, /connects AI apps it finds from now on/);
  } finally { sb.stop(); }
});

test('issue 284: a running daemon honours a background connect turned off after it started', async () => {
  const sb = sandbox();
  const codex = path.join(sb.home, '.codex');
  try {
    // init without --no-connect and with no app present, so the daemon starts with the background connect on
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only'], { extraEnv: BG }).code, 0);
    // then the person turns it off (as init --no-connect writes it) before the first run, and an app appears
    const c = cfg(sb); c.clients = { ...c.clients, auto_connect: false };
    fs.writeFileSync(path.join(sb.root, '.memev', 'config.json'), `${JSON.stringify(c, null, 2)}\n`, { mode: 0o600 });
    fs.mkdirSync(codex, { recursive: true });
    const run = await redetectRun(sb);
    assert.equal(run.skipped, 'auto_connect is off', `the daemon used the setting it started with: ${JSON.stringify(run)}`);
    assert.deepEqual(fs.readdirSync(codex), []);
  } finally { sb.stop(); }
});
