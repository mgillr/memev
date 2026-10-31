// MEM-142: customer-initiated secure remote setup session.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { parseCode, makeCode, SetupChannel } from '../src/engine/setup-channel.mjs';
import { checkAllowlist, appendLog, verifyChain, logPath, statusPath, sessionDir, redact } from '../src/cli/setup-remote.mjs';
import { detect } from '../src/cli/clients.mjs';
import { OperatorStub as BaseStub, makeOperatorKeys } from './setup-operator-stub.mjs';
import { Session as BaseSession } from '../src/cli/setup-remote.mjs';

// every stub and session a test opens is closed after it, pass or fail, so a failed assertion cannot
// leave a socket open and keep the run alive
const live = new Set();
class OperatorStub extends BaseStub { constructor(...a) { super(...a); live.add(this); } }
class Session extends BaseSession { constructor(...a) { super(...a); live.add(this); } }
afterEach(() => { for (const x of live) { try { x.revoke?.(); } catch {} try { x.close?.(); } catch {} } live.clear(); });
import { listeningSockets } from './helpers/proc.mjs';
import { freePort } from './helpers/cli.mjs';

const PKG = path.resolve(import.meta.dirname, '..');
const BIN = path.join(PKG, 'bin', 'memev.mjs');

function tmpRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-mem142-'));
  fs.mkdirSync(path.join(d, '.memev'), { recursive: true });
  fs.writeFileSync(path.join(d, '.memev', 'config.json'), '{}\n');
  return d;
}

function makeTestCode(port, opts = {}) {
  const keys = makeOperatorKeys();
  const sid = crypto.randomBytes(8).toString('hex');
  const secret = crypto.randomBytes(16).toString('hex');
  return {
    code: makeCode({ sid, secret, fingerprint: keys.fingerprint, host: '127.0.0.1', port, minutes: opts.minutes || 5 }),
    sid, secret, keys,
  };
}

function fixtureClock(start = Date.now()) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => { t += ms; },
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHs(stub, ms = 2000) {
  const t0 = Date.now();
  while (!stub._hsDone && Date.now() - t0 < ms) await sleep(20);
  return stub._hsDone;
}

test('MEM-142 AC01: session opens no listening socket and nothing starts it by itself', async () => {
  const root = tmpRoot();
  const port = freePort();
  const { code, sid, secret, keys } = makeTestCode(port);

  const stub = new OperatorStub({ sid, secret, port, minutes: 5, keys });
  await stub.start();

  const child = spawn(process.execPath, [BIN, 'setup', 'remote', '--code', code, '--root', root], {
    env: { ...process.env, MEMEV_ROOT: root },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  await new Promise((r) => setTimeout(r, 1500));

  const listening = listeningSockets(child.pid);
  assert.equal(listening.length, 0, `process has ${listening.length} listening sockets`);

  child.kill('SIGINT');
  await new Promise((r) => child.on('close', r));
  stub.close();
  fs.rmSync(root, { recursive: true, force: true });

  const srcFiles = fs.readdirSync(path.join(PKG, 'src', 'cli'), { recursive: true }).filter((f) => String(f).endsWith('.mjs'));
  for (const f of srcFiles) {
    const p = path.join(PKG, 'src', 'cli', f);
    if (f === 'setup-remote.mjs') continue;
    const content = fs.readFileSync(p, 'utf8');
    assert.ok(!content.includes("setup remote --code"), `${f} references setup remote --code`);
  }
});

test('MEM-142 AC02: session is outbound only and malformed code is refused before any connection', async () => {
  const root = tmpRoot();

  const badCodes = [
    'not-a-code',
    'memev-setup-v1:abc:def',
    'memev-setup-v2:aaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc:127.0.0.1:9999:5',
    'memev-setup-v1:AAAAAAAAAAAAAAAA:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc:127.0.0.1:9999:5',
    'memev-setup-v1:aaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc:127.0.0.1:0:5',
    'memev-setup-v1:aaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc:127.0.0.1:9999:999',
  ];
  for (const bc of badCodes) {
    const r = spawnSync(process.execPath, [BIN, 'setup', 'remote', '--code', bc, '--root', root], {
      encoding: 'utf8', timeout: 5000,
    });
    assert.notEqual(r.status, 0, `malformed code should be refused: ${bc}`);
    const out = (r.stdout || '') + (r.stderr || '');
    assert.ok(out.includes('invalid setup code') || out.includes('refused'), `expected refusal message for: ${bc}`);
  }

  const port = freePort();
  const { code, sid, secret, keys } = makeTestCode(port);
  const stub = new OperatorStub({ sid, secret, port, minutes: 5, keys });
  await stub.start();

  const child = spawn(process.execPath, [BIN, 'setup', 'remote', '--code', code, '--root', root], {
    env: { ...process.env, MEMEV_ROOT: root },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  await new Promise((r) => setTimeout(r, 1500));

  const listening = listeningSockets(child.pid);
  assert.equal(listening.length, 0, 'no listening sockets');

  child.kill('SIGINT');
  await new Promise((r) => child.on('close', r));
  stub.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('MEM-142 AC03: mutual auth: good handshake, wrong key, wrong secret, replay, tamper', async () => {
  // Good handshake
  {
    const port = freePort();
    const { sid, secret, keys } = makeTestCode(port);
    const stub = new OperatorStub({ sid, secret, port, minutes: 5, keys });
    await stub.start();
    const ch = new SetupChannel({ host: '127.0.0.1', port, sid, secret, fingerprint: keys.fingerprint });
    await ch.connect();
    assert.ok(ch._hsDone, 'handshake completed');
    ch.close();
    stub.close();
  }

  // Wrong operator key
  {
    const port = freePort();
    const { sid, secret, keys } = makeTestCode(port);
    const stub = new OperatorStub({ sid, secret, port, minutes: 5, keys, faults: { wrongKey: true } });
    await stub.start();
    const ch = new SetupChannel({ host: '127.0.0.1', port, sid, secret, fingerprint: keys.fingerprint });
    await assert.rejects(() => ch.connect(), /mismatch|invalid/);
    ch.close();
    stub.close();
  }

  // Wrong one-time secret
  {
    const port = freePort();
    const { sid, secret, keys } = makeTestCode(port);
    const stub = new OperatorStub({ sid, secret, port, minutes: 5, keys, faults: { wrongSecret: true } });
    await stub.start();
    const ch = new SetupChannel({ host: '127.0.0.1', port, sid, secret, fingerprint: keys.fingerprint });
    await assert.rejects(() => ch.connect(), /proof|handshake|Error/);
    ch.close();
    stub.close();
  }

  // Replayed handshake (same sid used twice)
  {
    const port = freePort();
    const { sid, secret, keys } = makeTestCode(port);
    const stub = new OperatorStub({ sid, secret, port, minutes: 5, keys });
    await stub.start();
    const ch1 = new SetupChannel({ host: '127.0.0.1', port, sid, secret, fingerprint: keys.fingerprint });
    await ch1.connect();
    ch1.close();
    await new Promise((r) => setTimeout(r, 200));
    const ch2 = new SetupChannel({ host: '127.0.0.1', port, sid, secret, fingerprint: keys.fingerprint });
    await assert.rejects(() => ch2.connect(), /replay|handshake|Error|ECONNREFUSED/);
    ch2.close();
    stub.close();
  }

  // Tampered message (flip a byte in the encrypted frame)
  {
    const port = freePort();
    const { sid, secret, keys } = makeTestCode(port);
    const stub = new OperatorStub({ sid, secret, port, minutes: 5, keys });
    await stub.start();
    const ch = new SetupChannel({ host: '127.0.0.1', port, sid, secret, fingerprint: keys.fingerprint });
    await ch.connect();

    let gotError = false;
    ch.on('error', () => { gotError = true; });
    ch.on('close', () => {});

    const pt = Buffer.from(JSON.stringify({ kind: 'cmd', id: 99, argv: ['status'] }), 'utf8');
    const nonce = Buffer.alloc(12);
    nonce.writeBigUInt64BE(0n, 4);
    const c = crypto.createCipheriv('aes-256-gcm', stub.o2cKey, nonce);
    const ct = Buffer.concat([c.update(pt), c.final()]);
    const frame = Buffer.concat([ct, c.getAuthTag()]);
    frame[5] ^= 0xff;
    const hdr = Buffer.alloc(4);
    hdr.writeUInt32BE(frame.length);
    stub.sock.write(Buffer.concat([hdr, frame]));

    await new Promise((r) => setTimeout(r, 500));
    assert.ok(gotError, 'tampered frame should cause an error');
    ch.close();
    stub.close();
  }
});

test('MEM-142 AC04: session is time-limited and ends itself', async () => {
  const root = tmpRoot();
  const port = freePort();
  const { code, sid, secret, keys } = makeTestCode(port, { minutes: 1 });

  const stub = new OperatorStub({ sid, secret, port, minutes: 1, keys });
  await stub.start();

  const clock = fixtureClock();
  const outLines = [];
  const session = new Session({
    root, code: parseCode(code), clock,
    outStream: { write: (s) => outLines.push(s) },
    execute: (argv) => ({ ok: true, code: 0, out: 'ok' }),
  });

  const startP = session.start();
  await new Promise((r) => setTimeout(r, 500));

  assert.ok(session.channel?._hsDone, 'session connected');

  clock.advance(61_000);
  session.tick();
  await new Promise((r) => setTimeout(r, 300));

  assert.ok(session.done, 'session should be done after time limit');
  assert.ok(session.channel?.closed, 'channel closed');
  assert.equal(session.channel?.c2oKey, null, 'keys wiped');

  stub.sendFinish();
  await startP;
  stub.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('MEM-142 AC05: customer can revoke with Ctrl-C and stop command', async () => {
  const root = tmpRoot();
  const port = freePort();
  const { code, sid, secret, keys } = makeTestCode(port);

  const stub = new OperatorStub({ sid, secret, port, minutes: 5, keys });
  await stub.start();

  const child = spawn(process.execPath, [BIN, 'setup', 'remote', '--code', code, '--root', root], {
    env: { ...process.env, MEMEV_ROOT: root },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  await new Promise((r) => setTimeout(r, 1500));

  const sp = statusPath(root, sid);
  assert.ok(fs.existsSync(sp), 'status file exists');

  child.kill('SIGINT');
  await new Promise((r) => child.on('close', r));

  assert.ok(!fs.existsSync(sp), 'status file removed after revoke');

  // stop command from second terminal
  const p2 = freePort();
  const t2 = makeTestCode(p2);
  const stub2 = new OperatorStub({ sid: t2.sid, secret: t2.secret, port: p2, minutes: 5, keys: t2.keys });
  await stub2.start();

  const child2 = spawn(process.execPath, [BIN, 'setup', 'remote', '--code', t2.code, '--root', root], {
    env: { ...process.env, MEMEV_ROOT: root },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  await new Promise((r) => setTimeout(r, 1500));

  const r = spawnSync(process.execPath, [BIN, 'setup', 'remote', 'stop', '--root', root], {
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(r.status, 0, 'stop command succeeds');

  await new Promise((resolve) => {
    const t = setTimeout(resolve, 3000);
    child2.on('close', () => { clearTimeout(t); resolve(); });
  });

  assert.ok(!fs.existsSync(statusPath(root, t2.sid)), 'status file removed after stop');
  stub.close();
  stub2.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('MEM-142 AC06: allowlist enforces scoped commands', async () => {
  const root = tmpRoot();
  const apps = detect();
  const foundApp = apps.find((a) => a.found && a.supported !== false);
  const notFoundApp = apps.find((a) => !a.found && a.supported !== false);
  const unsupportedApp = apps.find((a) => a.supported === false);

  const allowed = [
    ['doctor'], ['status'], ['deployment', 'show'], ['deployment', 'set', 'local'],
    ['deployment', 'set', 'container'], ['license', 'status'], ['license', 'install', 'key.lic'],
    ['devices', 'list'], ['ready'], ['setup', 'remote', 'log'],
  ];
  if (foundApp) allowed.push(['connect', foundApp.id]);
  for (const argv of allowed) {
    const r = checkAllowlist(argv, root);
    assert.ok(r.ok, `should allow: ${argv.join(' ')}: ${r.reason}`);
  }

  const refused = [
    { argv: ['shell'], reason: 'not in allowlist' },
    { argv: ['ls', '/etc/passwd'], reason: 'not in allowlist' },
    { argv: ['cat', '/etc/shadow'], reason: 'not in allowlist' },
    { argv: ['deployment', 'set', 'cloud'], reason: 'deployment mode' },
    { argv: ['license', 'install', '../../etc/passwd'], reason: 'escapes vault' },
    { argv: ['license', 'install', '/etc/passwd'], reason: 'escapes vault' },
    { argv: ['token', 'list'], reason: 'not in allowlist' },
    { argv: ['admin-token'], reason: 'not in allowlist' },
    { argv: ['setup', 'remote', '--code', 'x'], reason: 'only log' },
    { argv: [], reason: 'empty' },
    { argv: ['connect', 'all'], reason: 'all is not allowed' },
  ];
  if (notFoundApp) refused.push({ argv: ['connect', notFoundApp.id], reason: 'app not found' });
  if (unsupportedApp) refused.push({ argv: ['connect', unsupportedApp.id], reason: 'app unsupported' });
  for (const { argv, reason } of refused) {
    const r = checkAllowlist(argv, root);
    assert.ok(!r.ok, `should refuse: ${argv.join(' ') || '(empty)'} (${reason})`);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('MEM-142 AC07: hash-chained log with redaction and chain verification', async () => {
  const root = tmpRoot();
  const sid = 'a'.repeat(16);
  const secret = 'b'.repeat(32);

  appendLog(root, sid, { ts: '2026-01-01T00:00:00Z', kind: 'start', host: '127.0.0.1', port: 9999, limit: 5 });
  appendLog(root, sid, { ts: '2026-01-01T00:00:01Z', kind: 'connected' });
  appendLog(root, sid, { ts: '2026-01-01T00:00:02Z', kind: 'request', id: 1, argv: 'doctor' });
  appendLog(root, sid, { ts: '2026-01-01T00:00:03Z', kind: 'result', id: 1, ok: true, code: 0 });

  const v = verifyChain(root, sid);
  assert.ok(v.ok, `chain should be intact: ${v.reason}`);
  assert.equal(v.count, 4);

  const lp = logPath(root, sid);
  const lines = fs.readFileSync(lp, 'utf8').trim().split('\n');
  assert.equal(lines.length, 4);
  const first = JSON.parse(lines[0]);
  assert.equal(first.prev, '0'.repeat(64));
  const second = JSON.parse(lines[1]);
  assert.equal(second.prev, crypto.createHash('sha256').update(lines[0]).digest('hex'));

  // Redaction
  const line = JSON.stringify({ kind: 'test', secret });
  const redacted = redact(line, secret);
  assert.ok(!redacted.includes(secret), 'secret should be redacted');
  assert.ok(redacted.includes('***'), 'redaction marker present');

  // Tamper the log and verify chain breaks
  fs.appendFileSync(lp, '{"ts":"2026-01-01T00:00:04Z","kind":"forged","prev":"0'.repeat(1) + '"}\n');
  const v2 = verifyChain(root, sid);
  assert.ok(!v2.ok, 'tampered chain should fail');

  fs.rmSync(root, { recursive: true, force: true });
});

test('MEM-142 AC08: no stored credentials, code works once, only log and status written', async () => {
  const root = tmpRoot();
  const port = freePort();
  const { code, sid, secret, keys } = makeTestCode(port);

  const stub = new OperatorStub({ sid, secret, port, minutes: 5, keys });
  await stub.start();

  const outLines = [];
  const session = new Session({
    root, code: parseCode(code),
    outStream: { write: (s) => outLines.push(s) },
    execute: (argv) => ({ ok: true, code: 0, out: 'ok' }),
  });

  const p = session.start();
  await new Promise((r) => setTimeout(r, 500));

  const dir = sessionDir(root);
  const files = fs.readdirSync(dir);
  assert.ok(files.includes(`${sid}.log`), 'log file exists');
  assert.ok(files.includes(`${sid}.status`), 'status file exists');
  for (const f of files) {
    const content = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!content.includes(secret), `${f} should not contain the secret`);
    assert.ok(!/private|key|token/i.test(content) || f.endsWith('.log'), `${f} should not hold key material`);
  }

  session.revoke();
  await p;

  // Replay: same sid should be refused
  const session2 = new Session({
    root, code: parseCode(code),
    outStream: { write: (s) => outLines.push(s) },
    execute: (argv) => ({ ok: true, code: 0, out: 'ok' }),
  });
  const r2 = await session2.start();
  assert.ok(!r2.ok, 'replayed code should be refused');
  assert.match(r2.reason, /one-time|already used/);

  stub.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('MEM-142 AC05: a command round trip through the channel returns its result', async () => {
  const root = tmpRoot();
  const port = freePort();
  const { code, sid, secret, keys } = makeTestCode(port);
  const stub = new OperatorStub({ sid, secret, port, minutes: 5, keys });
  await stub.start();

  const seen = [];
  let session = null;
  const p = (session = new Session({
    root, code: parseCode(code),
    outStream: { write: () => {} },
    execute: (argv) => { seen.push(argv); return { ok: true, code: 0, out: `ran ${argv.join(' ')}` }; },
  })).start();
  try {
    assert.ok(await waitHs(stub), 'handshake completed');

    const id = stub.sendCmd(['status']);
    const res = await stub.waitForResult(id, 10000);
    assert.ok(res.ok, 'result is ok');
    assert.equal(res.code, 0);
    assert.ok(res.out.includes('ran status'), 'result carries the command output');
    assert.deepEqual(seen, [['status']], 'the client ran the command');
  } finally {
    session.revoke();
    await p;
    stub.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('MEM-142 AC03: a replayed frame is refused and the session ends', async () => {
  const root = tmpRoot();
  const port = freePort();
  const { code, sid, secret, keys } = makeTestCode(port);
  const stub = new OperatorStub({ sid, secret, port, minutes: 5, keys });
  await stub.start();

  const outLines = [];
  let session = null;
  const p = (session = new Session({
    root, code: parseCode(code),
    outStream: { write: (s) => outLines.push(s) },
    execute: (argv) => { outLines.push(`ran ${argv.join(' ')}`); return { ok: true, code: 0, out: 'ok' }; },
  })).start();
  try {
    assert.ok(await waitHs(stub), 'handshake completed');

    const id = stub.sendCmd(['status']);
    await stub.waitForResult(id, 10000);

    const pt = Buffer.from(JSON.stringify({ kind: 'cmd', id: 50, argv: ['status'] }), 'utf8');
    const nonce = Buffer.alloc(12);
    nonce.writeBigUInt64BE(0n, 4);
    const c = crypto.createCipheriv('aes-256-gcm', stub.o2cKey, nonce);
    const frame = Buffer.concat([Buffer.concat([c.update(pt), c.final()]), c.getAuthTag()]);
    stub.sendRaw(frame);
    stub.sendRaw(frame);

    await new Promise((r) => {
      const t = setTimeout(r, 2000);
      const iv = setInterval(() => {
        if (session.done) { clearInterval(iv); clearTimeout(t); r(); }
      }, 20);
    });

    assert.ok(session.done, 'session ended after the replayed frame');
    assert.ok(outLines.some((l) => l.includes('frame auth failed')), 'replay refused with an auth failure');
    assert.equal(outLines.filter((l) => l.startsWith('ran ')).length, 1, 'the replayed command did not run again');
    const endLine = outLines.find((l) => l.startsWith('session ended:'));
    assert.ok(endLine, 'the customer sees why the session ended');
  } finally {
    session.revoke();
    await p;
    stub.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('MEM-142 AC05: the first command in the same read as the auth frame still runs', async () => {
  const root = tmpRoot();
  const port = freePort();
  const { code, sid, secret, keys } = makeTestCode(port);
  const stub = new OperatorStub({ sid, secret, port, minutes: 5, keys });
  await stub.start();

  const origPlain = stub._sendPlain.bind(stub);
  stub._sendPlain = function (obj) {
    if (obj.type === 'auth') {
      const p = Buffer.from(JSON.stringify(obj));
      const h = Buffer.alloc(4);
      h.writeUInt32BE(p.length);
      this._held = Buffer.concat([h, p]);
      return Promise.resolve();
    }
    return origPlain(obj);
  };
  const origSend = stub.send.bind(stub);
  stub.send = function (obj) {
    const w = this.sock.write.bind(this.sock);
    if (this._held) {
      const held = this._held;
      this._held = null;
      this.sock.write = (buf, cb) => { this.sock.write = w; return w(Buffer.concat([held, buf]), cb); };
    }
    return origSend(obj);
  };

  const outLines = [];
  const seen = [];
  let session = null;
  const p = (session = new Session({
    root, code: parseCode(code),
    outStream: { write: (s) => outLines.push(s) },
    execute: (argv) => { seen.push(argv); return { ok: true, code: 0, out: 'ran' }; },
  })).start();
  try {
    assert.ok(await waitHs(stub), 'handshake completed');

    const id = stub.sendCmd(['status']);
    const res = await stub.waitForResult(id, 10000);
    assert.ok(res.ok, 'the command ran and returned a result');
    assert.deepEqual(seen, [['status']], 'the client ran the command');
  } finally {
    session.revoke();
    const settled = await Promise.race([p.then(() => 'returned'), sleep(3000).then(() => 'still pending')]);
    assert.equal(settled, 'returned', 'start() settles after revoke');
    stub.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('MEM-142 AC09: no convergence code added, operator side is only a test stub', async () => {
  const sc = fs.readFileSync(path.join(PKG, 'src', 'engine', 'setup-channel.mjs'), 'utf8');
  assert.ok(!/convergence/i.test(sc), 'setup-channel should not contain convergence code');
  assert.ok(!/merge.*engine|engine.*merge/i.test(sc), 'setup-channel should not reference engine merge');

  const testDir = path.join(PKG, 'test');
  const stubFiles = fs.readdirSync(testDir).filter((f) => f.includes('operator'));
  assert.ok(stubFiles.length >= 1, 'operator stub exists in test/');
  for (const f of stubFiles) {
    assert.ok(f.startsWith('setup-operator'), `operator file should be setup-operator-*: ${f}`);
  }
});

test('MEM-142 AC10: docs explain the mode in plain words', async () => {
  const docPath = path.join(PKG, 'docs', 'SETUP-SESSION.md');
  assert.ok(fs.existsSync(docPath), 'docs/SETUP-SESSION.md exists');
  const doc = fs.readFileSync(docPath, 'utf8').toLowerCase();

  assert.ok(doc.includes('you start'), 'says you start it');
  assert.ok(doc.includes('nothing runs unless you start it') || doc.includes('nothing runs until you start it'), 'says nothing runs unless started');
  assert.ok(doc.includes('no inbound port') || doc.includes('needs no inbound port'), 'says no inbound port');
  assert.ok(doc.includes('ends by itself') || doc.includes('ends on its own'), 'says it ends by itself');
  assert.ok(doc.includes('log'), 'mentions the log');
  assert.ok(doc.includes('stop'), 'mentions how to stop');
  assert.ok(doc.includes('telemetry'), 'mentions telemetry');
  assert.ok(!doc.includes('certified'), 'does not claim certification');
  assert.ok(!doc.includes('certification'), 'does not claim certification');
  assert.ok(!doc.includes('external review'), 'does not claim external review');
  assert.ok(doc.includes('docker'), 'mentions the docker alternative');
});

test('MEM-142 AC11: house writing check on docs, changelog, and printed strings', async () => {
  const files = [
    path.join(PKG, 'docs', 'SETUP-SESSION.md'),
    path.join(PKG, 'changelog.d', 'MEM-142.md'),
  ];
  const banned = [
    /seamless/i, /robust/i, /powerful/i, /leverage/i, /unlock/i, /cutting.edge/i,
    /not just .* but /i, /certified/i, /!\s*$/, /[\u{1F300}-\u{1FAFF}]/u,
    /\u2014/,
  ];
  for (const f of files) {
    assert.ok(fs.existsSync(f), `${f} exists`);
    const content = fs.readFileSync(f, 'utf8');
    for (const pat of banned) {
      assert.ok(!pat.test(content), `${f} contains banned pattern: ${pat}`);
    }
  }

  const src = fs.readFileSync(path.join(PKG, 'src', 'cli', 'setup-remote.mjs'), 'utf8');
  for (const pat of banned) {
    assert.ok(!pat.test(src), `setup-remote.mjs contains banned pattern: ${pat}`);
  }
});
