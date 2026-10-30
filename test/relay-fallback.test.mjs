// WO-06-A: with the relay off or unreachable, the vault degrades to the git backup and never loses
// data. Three behaviours: switching the relay off falls back with the tree byte for byte unchanged,
// the doctor says so in one line a session sees only if it calls memev_doctor, and an unreachable
// relay backs off on a growing pause without blocking the daemon's other jobs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
  v.remember(OWNER, { text: 'the kettle is blue', kind: 'fact' });
  // the vault was using the relay
  setRelay(root, { enabled: true, url: 'relay://127.0.0.1:9', domain: 'relay.test' });
  const base = syncOnce(v, { root });
  assert.equal(base.remote, 'origin', `baseline sync: ${base.error}`);
  assert.equal(base.pushed, true, `baseline push: ${base.error}`);
  // switch the relay off
  setRelay(root, { enabled: false });
  assert.equal(relaySetting(root).enabled, false, 'the relay is still on after switching it off');
  // a note written after the relay went off
  v.remember(OWNER, { text: 'the spoon is new', kind: 'fact' });
  // the next sync still runs through the git backup provider
  assert.equal(selectProvider('sync', { root, config: v.config }).id, 'git', 'the sync provider is no longer the git backup');
  const res = syncOnce(v, { root });
  assert.equal(res.remote, 'origin', `sync after the relay went off: ${res.error}`);
  assert.equal(res.pushed, true, `push after the relay went off: ${res.error}`);
  // the git backup holds the vault tree byte for byte: nothing missing, nothing rewritten
  assert.deepEqual(backupTree(bare), localTree(root), 'the git backup does not hold the vault tree byte for byte');
  v.close();
});

test('WO-06-A AC02: the doctor names the relay off or unreachable on the backup check line, and the line reaches a session only if it calls memev_doctor', () => {
  const { root, v } = newVault();
  gitBackup(root);
  const env = { MEMEV_CONFIG_DIR: tmpdir('conf-') };
  // the relay was set up, then switched off
  setRelay(root, { enabled: false, url: 'relay://127.0.0.1:9', domain: 'relay.test' });
  const backup = fileChecks({ root, env, vault: v }).find((c) => c.id === 'backup');
  // one line on the existing backup check: the relay as off, the backup as the path in use, the command that switches it back on
  assert.match(backup.detail, /the relay is off/, 'the backup check does not name the relay as off');
  assert.match(backup.detail, /git backup/, 'the backup check does not name the git backup as the path in use');
  assert.match(backup.detail, /memev cloud relay on/, 'the backup check does not name the command that switches the relay back on');
  // with the relay on but unreachable, the same check names it
  setRelay(root, { enabled: true });
  fs.writeFileSync(path.join(root, '.memev', 'relay-state.json'), JSON.stringify({ enabled: true, state: 'cannot reach the relay (retrying)' }));
  const unreachable = fileChecks({ root, env, vault: v }).find((c) => c.id === 'backup');
  assert.match(unreachable.detail, /the relay is on but unreachable/, 'the backup check does not name the relay as unreachable');
  assert.match(unreachable.detail, /git backup/, 'the unreachable line does not name the git backup as the path in use');
  // with a tunnel up, the backup is not the only path
  fs.writeFileSync(path.join(root, '.memev', 'tunnel.json'), JSON.stringify({ state: 'up' }));
  const tunneled = fileChecks({ root, env, vault: v }).find((c) => c.id === 'backup');
  assert.doesNotMatch(tunneled.detail, /only through/, 'the line says the backup is the only path while a tunnel is up');
  assert.match(tunneled.detail, /through the tunnel and/, 'the line does not name the tunnel as a path in use');
  // the line reaches a session only if it calls memev_doctor: not the resume card, not the protocol
  const card = renderCard(v.sessionStart(OWNER, { task: 'check the backup' }));
  assert.doesNotMatch(card, /the relay is off/, 'the relay-off line reached the resume card');
  assert.doesNotMatch(PROTOCOL + PROTOCOL_POINTER, /the relay is off/, 'the relay-off line reached the protocol');
  v.close();
});

test('WO-06-A AC03: with the relay configured and unreachable, the client reports the failure, waits a growing pause, and never blocks the other jobs', async (t) => {
  const { root, v } = newVault();
  // a background job that must keep running while the relay retries
  let jobs = 0;
  const startedAt = Date.now();
  const job = setInterval(() => { jobs++; }, 20);
  const clients = [];
  t.after(() => { for (const c of clients) c.stop(); clearInterval(job); v.close(); });

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
    // the pause grows before each retry (half a second, then double)
    const gaps = retries.slice(1).map((t, i) => t - retries[i]);
    assert.ok(gaps[1] > gaps[0], `the pause should grow before each retry: ${gaps.join(', ')} ms`);
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
    // the pause grows before each retry
    const gaps = retries.slice(1).map((t, i) => t - retries[i]);
    assert.ok(gaps[1] > gaps[0], `the pause should grow before each retry: ${gaps.join(', ')} ms`);
  }

  // the other background jobs kept running: the relay retries never block the event loop, so the
  // job ticks at least a quarter of the rate the elapsed time allows, even on a loaded machine
  const elapsedMs = Date.now() - startedAt;
  assert.ok(jobs > elapsedMs / 80, `the background jobs kept running: ${jobs} ticks in ${elapsedMs} ms`);
});
