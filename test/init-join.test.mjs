// init asks on a terminal, and --join adds this computer without creating a vault here.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { newVault, cleanup, tmpdir, PKG } from './helpers/tmp.mjs';
import { signLicense } from '../src/engine/license.mjs';
import { mintInvite } from '../src/engine/devices.mjs';
import { createServer } from '../src/server/http.mjs';
import { remoteFile } from '../src/cli/remote.mjs';
import { sandbox } from './helpers/cli.mjs';

after(() => cleanup());

const BIN = path.join(PKG, 'bin', 'memev.mjs');
const day = (o) => new Date(Date.now() + o * 86400e3).toISOString().slice(0, 10);

function host() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const keys = { 'test-vendor': publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const { root, v } = newVault();
  const confDir = tmpdir('init-join-host-');
  fs.writeFileSync(path.join(confDir, 'license.json'), JSON.stringify(signLicense({ v: 1, lid: 'lic_init0020', tier: 'team', services: ['sync'], seats: 3, iat: day(-1), exp: day(300), grace_days: 14 }, pem, 'test-vendor')));
  const server = createServer(v, { tunnelKey: () => null, licenseKeys: keys, env: { MEMEV_CONFIG_DIR: confDir } });
  return { v, server, root };
}

function listen(server) { return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port))); }

function laptopEnv() {
  const home = tmpdir('init-join-laptop-');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude.json'), '{}\n');
  const root = path.join(home, 'memev');
  return {
    PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'),
    MEMEV_CONFIG_DIR: path.join(home, '.config', 'memev'), MEMEV_ROOT: root,
    MEMEV_NO_SERVICE: '1', MEMEV_NO_TUNNEL: '1', MEMEV_NO_BACKGROUND: '1', MEMEV_NO_DOWNLOAD: '1',
  };
}

function cli(env, args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [BIN, ...args], { env });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => { p.kill(); resolve({ code: 1, out, err: `${err}\ntimeout` }); }, 20000);
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
  });
}

// A real terminal, so init sees isTTY and asks. Answers are written when a question mark appears.
function cliTTY(env, args, answer) {
  const py = `
import os, pty, select, sys
answer = sys.argv[1]
pid, fd = pty.fork()
if pid == 0:
    os.execvpe(sys.argv[2], sys.argv[2:], os.environ)
sent = False
out = b""
while True:
    ready, _, _ = select.select([fd], [], [], 20)
    if not ready:
        try: os.kill(pid, 15)
        except OSError: pass
        break
    try: chunk = os.read(fd, 4096)
    except OSError: break
    if not chunk: break
    out += chunk
    if (not sent) and b"?" in out:
        os.write(fd, (answer + chr(10)).encode())
        sent = True
_, status = os.waitpid(pid, 0)
sys.stdout.buffer.write(out)
sys.exit(os.waitstatus_to_exitcode(status))
`;
  const r = spawnSync('python3', ['-c', py, answer, process.execPath, BIN, ...args], { env, encoding: 'utf8', timeout: 25000 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

test('MEM-020 AC01: On a TTY, answering \'joining\' runs the join flow and creates no local vault', () => {
  const env = laptopEnv();
  const r = cliTTY(env, ['init'], 'joining');
  assert.match(r.out, /memev join <code>/, r.err + r.out);
  assert.equal(fs.existsSync(env.MEMEV_ROOT), false);
  assert.equal(fs.existsSync(remoteFile(env)), false);
});

test('MEM-020 AC02: memev init --join <invite> joins without prompting', async () => {
  const h = host();
  const port = await listen(h.server);
  try {
    const minted = mintInvite(h.root, { address: `http://127.0.0.1:${port}`, ttlSec: 600 });
    const env = laptopEnv();
    const r = await cli(env, ['init', '--join', minted.code]);
    assert.equal(r.code, 0, r.err + r.out);
    assert.equal(/first computer/.test(r.out), false);
    assert.equal(fs.existsSync(env.MEMEV_ROOT), false);
    const saved = JSON.parse(fs.readFileSync(remoteFile(env), 'utf8'));
    assert.equal(saved.url, `http://127.0.0.1:${port}`);
    assert.ok(saved.token);
  } finally { h.server.close(); h.v.close(); }
});

test('MEM-020 AC03: Non-TTY init without --join prints one line explaining memev init --join for a second computer', () => {
  const sb = sandbox();
  try {
    const r = sb.run(['init', '--port', String(sb.port), '--no-connect']);
    assert.equal(r.code, 0, r.out + r.err);
    const lines = r.out.split('\n').filter((l) => l.includes('memev init --join'));
    assert.equal(lines.length, 1, r.out);
    assert.match(lines[0], /second computer/);
    assert.ok(fs.existsSync(path.join(sb.root, '.memev', 'config.json')));
  } finally { sb.stop(); }
});
