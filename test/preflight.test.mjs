// The preflight runs first in init: Node 22 or newer, git, the port and a folder to write to are checked
// before a single file is created, and each failed check says what is missing and the fix for this system.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { sandbox, freePort } from './helpers/cli.mjs';
import { tmpdir, cleanup } from './helpers/tmp.mjs';
import { checkEnvironment, gate, fixFor, canWrite } from '../src/cli/preflight.mjs';

after(cleanup);

const gitOk = () => ({ ok: true, out: 'git version 2.47.0' });
const gitMissing = () => ({ ok: false, out: '' });
const portFreeCheck = async (root, wanted) => ({ state: 'free', port: wanted });
const base = (over = {}) => ({ env: { ...process.env, MEMEV_CONFIG_DIR: path.join(tmpdir(), 'cfg') }, root: path.join(tmpdir(), 'memev'), run: gitOk, portCheck: portFreeCheck, writable: () => true, platform: 'linux', nodeVersion: '22.12.0', ...over });
const byId = (items) => Object.fromEntries(items.map((i) => [i.id, i]));

test('MEM-001 AC02: Preflight checks Node 22+, git present, port free and home writable, and returns one result per check', async () => {
  const ok = await checkEnvironment(base());
  assert.deepEqual(ok.map((i) => i.id), ['node', 'git', 'port', 'home'], 'one result per check, in order');
  assert.ok(ok.every((i) => i.ok && i.state === 'granted'), JSON.stringify(ok));

  const old = byId(await checkEnvironment(base({ nodeVersion: '20.11.1' })));
  assert.equal(old.node.ok, false); assert.match(old.node.detail, /20\.11\.1/);
  assert.equal(old.git.ok && old.port.ok && old.home.ok, true, 'only Node fails');
  assert.equal(byId(await checkEnvironment(base({ nodeVersion: '22.0.0' }))).node.ok, true);
  assert.equal(byId(await checkEnvironment(base({ nodeVersion: '24.1.0' }))).node.ok, true);

  const nogit = byId(await checkEnvironment(base({ run: gitMissing })));
  assert.equal(nogit.git.ok, false); assert.match(nogit.git.detail, /git/);
  assert.equal(nogit.node.ok && nogit.port.ok && nogit.home.ok, true, 'only git fails');

  const noport = byId(await checkEnvironment(base({ portCheck: async (r, w) => ({ state: 'none', port: w }) })));
  assert.equal(noport.port.ok, false); assert.equal(noport.node.ok && noport.git.ok && noport.home.ok, true);

  const nohome = byId(await checkEnvironment(base({ writable: () => false })));
  assert.equal(nohome.home.ok, false); assert.equal(nohome.node.ok && nohome.git.ok && nohome.port.ok, true);
});

test('MEM-001 AC02: a taken port is not a failure while a free one is near: init moves to it', async () => {
  const sb = sandbox({ ports: 2 });
  const held = net.createServer((c) => c.destroy());
  await new Promise((r) => held.listen(sb.port, '127.0.0.1', r));
  try {
    const items = byId(await checkEnvironment({ env: sb.env, root: sb.root, port: sb.port }));
    assert.equal(items.port.ok, true);
    assert.equal(items.port.state, 'applied');
    assert.match(items.port.detail, /init will use \d+/);
  } finally { await new Promise((r) => held.close(r)); }
});

test('MEM-001 AC02: the home check looks at the real folders and writes nothing', () => {
  const dir = tmpdir(); const file = path.join(dir, 'a-file'); fs.writeFileSync(file, 'x');
  assert.equal(canWrite(path.join(dir, 'not', 'there', 'yet')), true, 'the nearest folder that exists is writable');
  assert.equal(canWrite(path.join(file, 'memev')), false, 'a file where a folder must be');
  assert.equal(fs.existsSync(path.join(dir, 'not')), false, 'checking created nothing');
});

test('MEM-001 AC03: On failure each check prints the fix for the platform it runs on (darwin, win32, linux), with the platform injected', async () => {
  const want = {
    darwin: { git: /xcode-select --install/, node: /brew install node/ },
    win32: { git: /winget install Git\.Git/, node: /winget install OpenJS\.NodeJS\.LTS/ },
    linux: { git: /sudo apt install git/, node: /nvm install 22|nodejs\.org/ },
  };
  for (const [platform, fixes] of Object.entries(want)) {
    const items = byId(await checkEnvironment(base({ platform, run: gitMissing, nodeVersion: '18.0.0', writable: () => false, portCheck: async (r, w) => ({ state: 'none', port: w }) })));
    assert.match(items.git.fix, fixes.git, `${platform} git`);
    assert.match(items.node.fix, fixes.node, `${platform} node`);
    for (const id of ['node', 'git', 'port', 'home']) assert.ok(items[id].fix.length > 10, `${platform} ${id} has a fix`);
    // what the person sees
    const lines = []; const log = console.log; console.log = (m) => lines.push(String(m));
    try { assert.equal(await gate(base({ platform, run: gitMissing })), false); } finally { console.log = log; }
    assert.match(lines.join('\n'), fixes.git, `${platform} printed`);
  }
  assert.equal(fixFor('git', 'linux').includes('Fedora'), true);
  assert.match(fixFor('home', 'linux', { dir: '/data/x' }), /chmod u\+w \/data\/x/);
});

test('MEM-001 AC04: init calls preflight before creating any file (a failing preflight leaves the vault directory absent)', () => {
  const sb = sandbox();
  const nodeonly = path.join(tmpdir('nodeonly-'), 'bin'); fs.mkdirSync(nodeonly);
  fs.symlinkSync(process.execPath, path.join(nodeonly, 'node'));
  const r = sb.run(['init', '--port', String(sb.port)], { extraEnv: { PATH: nodeonly } });
  assert.notEqual(r.code, 0, r.out + r.err);
  assert.match(r.out + r.err, /git/);
  assert.doesNotMatch(r.out + r.err, /Cannot read properties|TypeError|at .*\.mjs:\d+/);
  assert.equal(fs.existsSync(sb.root), false, 'no vault directory');
  assert.equal(fs.existsSync(sb.env.MEMEV_CONFIG_DIR), false, 'no config directory');
  assert.equal(fs.existsSync(path.join(sb.home, '.config')), false, 'nothing under the home config folder');
  assert.deepEqual(fs.readdirSync(sb.home), [], 'the home folder is still empty');

  // a vault folder that cannot be made (a file is in the way) stops the same way, with nothing written
  const blocker = path.join(sb.home, 'in-the-way'); fs.writeFileSync(blocker, 'x');
  const r2 = sb.run(['init', '--root', path.join(blocker, 'memev'), '--port', String(sb.port)]);
  assert.notEqual(r2.code, 0, r2.out + r2.err);
  assert.match(r2.out + r2.err, /home writable/);
  assert.equal(fs.existsSync(sb.env.MEMEV_CONFIG_DIR), false, 'still no config directory');
  assert.deepEqual(fs.readdirSync(sb.home), ['in-the-way']);

  // memev preflight on the same machine says the same and exits non-zero
  const p = sb.run(['preflight'], { extraEnv: { PATH: nodeonly } });
  assert.equal(p.code, 1); assert.match(p.out, /manual\s+git installed/);
});

test('MEM-001 AC05: memev help lists preflight', () => {
  const sb = sandbox();
  assert.match(sb.run(['help']).out, /memev preflight/);
});
