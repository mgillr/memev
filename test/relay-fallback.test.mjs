// WO-06-A: with the relay off or unreachable, the vault degrades to the git backup and never loses
// data. Three behaviours: switching the relay off falls back with the tree byte for byte unchanged,
// the doctor says so in one line a session sees only if it calls memev_doctor, and an unreachable
// relay backs off on a growing pause without blocking the daemon's other jobs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { newVault, cleanup, tmpdir, OWNER } from './helpers/tmp.mjs';
import { freePort } from './helpers/cli.mjs';
import { setRelay, relaySetting, startRelayClient } from '../src/cli/relay.mjs';
import { syncOnce } from '../src/cli/sync.mjs';
import { selectProvider } from '../src/services/providers.mjs';
import { fileChecks } from '../src/cli/doctor.mjs';
import { renderCard, PROTOCOL, PROTOCOL_POINTER } from '../src/engine/card.mjs';

after(cleanup);

// The vault's tree as a map of path to content, read straight from the files. .git is the backup's
// own machinery and .memev is local state (git-ignored), so neither is part of the tree the backup
// holds.
const localTree = (root) => {
  const out = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === '.memev') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out[path.relative(root, p).split(path.sep).join('/')] = fs.readFileSync(p);
    }
  };
  walk(root);
  return out;
};

// The tree the bare backup holds, as a map of path to content, read from the backup itself.
const backupTree = (bare) => {
  const list = execFileSync('git', ['--git-dir', bare, 'ls-tree', '-r', '--name-only', 'HEAD'], { encoding: 'utf8' });
  const out = {};
  for (const p of list.split('\n').filter(Boolean)) out[p] = execFileSync('git', ['--git-dir', bare, 'show', `HEAD:${p}`]);
  return out;
};

// A local bare repository the vault pushes to: the git backup, the path the relay falls back to.
const gitBackup = (root) => {
  const bare = path.join(root, '..', 'backup.git');
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', bare]);
  execFileSync('git', ['remote', 'add', 'origin', `file://${bare}`], { cwd: root });
  return bare;
};

// Poll until cond() is true, or fail after ms.
const waitFor = (cond, ms) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const t = setInterval(() => {
    if (cond()) { clearInterval(t); resolve(); }
    else if (Date.now() - t0 > ms) { clearInterval(t); reject(new Error(`timed out after ${ms} ms`)); }
  }, 50);
});

test('WO-06-A AC01: with the relay switched off, the next sync runs through the git backup and the vault tree is byte for byte unchanged', () => {
  const { root, v } = newVault();
  const bare = gitBackup(root);
  // a note long enough for the write gate, so the trees below hold real notes
  assert.equal(v.remember(OWNER, { text: 'The office kettle is the blue one by the window, because the old one leaked.', kind: 'fact' }).saved, true, 'the first note was not saved');
  // the vault was using the relay
  setRelay(root, { enabled: true, url: 'relay://127.0.0.1:9', domain: 'relay.test' });
  const base = syncOnce(v, { root });
  assert.equal(base.remote, 'origin', `baseline sync: ${base.error}`);
  assert.equal(base.pushed, true, `baseline push: ${base.error}`);
  // the vault tree as it was before the relay went off
  const baseline = localTree(root);
  // switch the relay off
  setRelay(root, { enabled: false });
  assert.equal(relaySetting(root).enabled, false, 'the relay is still on after switching it off');
  // a note written after the relay went off
  assert.equal(v.remember(OWNER, { text: 'The spoon drawer moved to the left of the sink after the kitchen refit.', kind: 'fact' }).saved, true, 'the note written after the relay went off was not saved');
  // the next sync still runs through the git backup provider
  assert.equal(selectProvider('sync', { root, config: v.config }).id, 'git', 'the sync provider is no longer the git backup');
  // the vault tree just before that sync, the new note included
  const before = localTree(root);
  assert.ok(Object.values(before).some((b) => b.includes('spoon drawer moved')), 'the note written after the relay went off is not in the vault');
  const res = syncOnce(v, { root });
  assert.equal(res.remote, 'origin', `sync after the relay went off: ${res.error}`);
  assert.equal(res.pushed, true, `push after the relay went off: ${res.error}`);
  // nothing the vault held before the relay went off was removed or rewritten: each file is still there and still starts
  // with its bytes from then (notes are appended, so a month file can only grow)
  const after = localTree(root);
  for (const [p, bytes] of Object.entries(baseline)) assert.ok(after[p] && after[p].subarray(0, bytes.length).equals(bytes), `${p} was removed or rewritten after the relay went off`);
  // the sync left the vault tree byte for byte as it was, and the git backup holds that same tree
  assert.deepEqual(after, before, 'the sync after the relay went off changed the vault tree');
  assert.deepEqual(backupTree(bare), before, 'the git backup does not hold the vault tree byte for byte');
  v.close();
});

test('WO-06-A AC02: the doctor names the relay off or unreachable on the backup check line, and the line reaches a session only if it calls memev_doctor', () => {
  const { root, v } = newVault();
  gitBackup(root);
  const env = { MEMEV_CONFIG_DIR: tmpdir('conf-') };
  // the relay was set up, then switched off
  setRelay(root, { enabled: false, url: 'relay://127.0.0.1:9', domain: 'relay.test' });
  const backupLine = (e = env) => fileChecks({ root, env: e, vault: v }).find((c) => c.id === 'backup').detail;
  const writeRelayState = (st) => fs.writeFileSync(path.join(root, '.memev', 'relay-state.json'), JSON.stringify(st));
  const backup = backupLine();
  // one line on the existing backup check: the relay as off, the backup as the path in use, the command that switches it back on
  assert.match(backup, /the relay is off/, 'the backup check does not name the relay as off');
  assert.match(backup, /git backup/, 'the backup check does not name the git backup as the path in use');
  assert.match(backup, /memev cloud relay on/, 'the backup check does not name the command that switches the relay back on');
  // the relay is the vault's address and the backup carries the notes: the line never calls the backup the way in
  assert.match(backup, /the relay address does not reach the vault/, 'the line does not say the relay address is what stops answering');
  assert.doesNotMatch(backup, /vault is reached/, 'the line calls the git backup the way the vault is reached');
  // with the relay on but unreachable, the same check names it
  setRelay(root, { enabled: true });
  writeRelayState({ enabled: true, state: 'cannot reach the relay (retrying)' });
  const unreachable = backupLine();
  assert.match(unreachable, /the relay is on but unreachable/, 'the backup check does not name the relay as unreachable');
  assert.match(unreachable, /git backup/, 'the unreachable line does not name the git backup as the path in use');
  // a first connect still under way is not a failure yet
  writeRelayState({ enabled: true, state: 'connecting' });
  assert.doesNotMatch(backupLine(), /the relay is/, 'the line names the relay while its first connect is still under way');
  // a relay the daemon is not holding (stopped, or held off by MEMEV_NO_TUNNEL) is not running, not unreachable
  writeRelayState({ enabled: false, state: 'off' });
  assert.doesNotMatch(backupLine(), /unreachable/, 'the line calls a relay the daemon is not holding unreachable');
  assert.match(backupLine(), /the relay is on but not running/, 'the line does not say the relay is not running');
  writeRelayState({ enabled: true, state: 'cannot reach the relay (retrying)' });
  const held = backupLine({ ...env, MEMEV_NO_TUNNEL: '1' });
  assert.doesNotMatch(held, /unreachable/, 'the line calls the relay unreachable under MEMEV_NO_TUNNEL');
  assert.match(held, /not running \(MEMEV_NO_TUNNEL is set\)/, 'the line does not name MEMEV_NO_TUNNEL');
  // with a tunnel up, the tunnel still reaches the vault
  assert.doesNotMatch(unreachable, /the tunnel does/, 'the line names a tunnel that is not up');
  fs.writeFileSync(path.join(root, '.memev', 'tunnel.json'), JSON.stringify({ state: 'up' }));
  assert.match(backupLine(), /the relay address does not reach the vault \(the tunnel does\)/, 'the line does not name the tunnel as reaching the vault');
  // the line reaches a session only if it calls memev_doctor: not the resume card, not the protocol
  const card = renderCard(v.sessionStart(OWNER, { task: 'check the backup' }));
  assert.doesNotMatch(card, /the relay is off/, 'the relay-off line reached the resume card');
  assert.doesNotMatch(PROTOCOL + PROTOCOL_POINTER, /the relay is off/, 'the relay-off line reached the protocol');
  v.close();
});

// The relay client needs only a folder for its identity (.memev/relay.json), not a vault.
const clientRoot = () => { const root = tmpdir(); fs.mkdirSync(path.join(root, '.memev'), { recursive: true }); return root; };

test('WO-06-A AC03: with the relay configured and unreachable, the client reports the failure, waits a growing pause, and never blocks the other jobs', async (t) => {
  const root = clientRoot();
  // a background job that must keep running while the relay retries
  let jobs = 0;
  const startedAt = Date.now();
  const job = setInterval(() => { jobs++; }, 20);
  const clients = [];
  t.after(() => { for (const c of clients) c.stop(); clearInterval(job); });

  // a refused port: the failure is immediate, and the pause grows before each retry
  {
    const port = freePort(); // nothing listens here, so the relay is unreachable
    const retries = [];
    const client = startRelayClient({
      root, port: 0, url: `relay://127.0.0.1:${port}`, domain: 'relay.test',
      onState: (s) => { if (s.state === 'cannot reach the relay (retrying)') retries.push(Date.now()); },
    });
    clients.push(client);
    await waitFor(() => retries.length >= 3, 8000);
    client.stop();
    // the client reported the failure
    assert.ok(retries.length >= 3, `expected at least three retry reports, got ${retries.length}`);
    // the pause doubles before each retry: at least half a second, then at least a second (a loaded
    // machine only makes a gap longer, so each gap has a floor)
    const gaps = retries.slice(1).map((t, i) => t - retries[i]);
    assert.ok(gaps[0] >= 450 && gaps[1] >= 950, `the pause should start at half a second and double: ${gaps.join(', ')} ms`);
  }

  // a non-routable address: how the network treats it varies by machine. On a network that
  // blackholes it, the ten second connect timeout ends each attempt; on a network that refuses
  // it, the failure is immediate. Either way the first report must come well before the operating
  // system would give up on its own (a hundred seconds or more), and the pause must grow before
  // each retry.
  {
    const t0 = Date.now();
    const retries = [];
    const client = startRelayClient({
      root, port: 0, url: 'relay://192.0.2.1:9', domain: 'relay.test',
      onState: (s) => { if (s.state === 'cannot reach the relay (retrying)') retries.push(Date.now() - t0); },
    });
    clients.push(client);
    await waitFor(() => retries.length >= 3, 60000);
    client.stop();
    // the first report comes well before the operating system would give up on its own
    assert.ok(retries[0] < 30000, `the first report came too late: ${retries[0]} ms`);
    // the pause doubles before each retry
    const gaps = retries.slice(1).map((t, i) => t - retries[i]);
    assert.ok(gaps[0] >= 450 && gaps[1] >= 950, `the pause should start at half a second and double: ${gaps.join(', ')} ms`);
  }

  // the other background jobs kept running: the relay retries never block the event loop, so the
  // job ticks at least a quarter of the rate the elapsed time allows, even on a loaded machine
  const elapsedMs = Date.now() - startedAt;
  assert.ok(jobs > elapsedMs / 80, `the background jobs kept running: ${jobs} ticks in ${elapsedMs} ms`);
});

test('WO-06-A AC03: a relay that takes the connection and never answers is dropped when the timeout ends, the drop is logged, and the client retries', async (t) => {
  const root = clientRoot();
  // a relay that accepts the connection, reads the hello and never answers
  const held = []; let hello = '';
  const silent = net.createServer((sock) => { held.push(sock); sock.on('error', () => {}); sock.on('data', (d) => { hello += d; }); });
  await new Promise((resolve) => silent.listen(0, '127.0.0.1', resolve));
  const logs = []; const states = [];
  const client = startRelayClient({
    root, port: 0, url: `relay://127.0.0.1:${silent.address().port}`, domain: 'relay.test', connectTimeoutMs: 300,
    log: (m) => logs.push(m), onState: (s) => states.push(s.state),
  });
  t.after(() => { client.stop(); for (const sock of held) sock.destroy(); silent.close(); });
  // the attempt ends at the timeout and the client goes on to retry, instead of connecting for good
  await waitFor(() => states.includes('cannot reach the relay (retrying)'), 5000);
  // the TCP connect worked and the hello went out: it is the relay's answer that never came
  assert.match(hello, /"t":"hello"/, 'the client never sent its hello');
  // the drop is logged, so a timeout never passes silently
  assert.ok(logs.some((l) => /no answer within 300 ms/.test(l)), `the timeout was not logged: ${logs.join(' | ')}`);
});
