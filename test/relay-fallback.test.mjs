// WO-06-A: with the relay off or unreachable, the vault degrades to the git backup and never loses
// data. Three behaviours: switching the relay off falls back with the tree byte for byte unchanged,
// the doctor says so in one line that stays out of a session's context, and an unreachable relay
// backs off on a growing pause without blocking the daemon's other jobs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { newVault, cleanup, tmpdir, OWNER } from './helpers/tmp.mjs';
import { freePort } from './helpers/cli.mjs';
import { setRelay, relaySetting, startRelayClient } from '../src/cli/relay.mjs';
import { syncOnce } from '../src/cli/sync.mjs';
import { selectProvider } from '../src/services/providers.mjs';
import { fileChecks } from '../src/cli/doctor.mjs';
import { renderCard, PROTOCOL, PROTOCOL_POINTER } from '../src/engine/card.mjs';

after(cleanup);

// The vault's tracked tree as a map of path to content hash. The git backup carries this tree, and it
// is what "byte for byte what it was" means. .git is the backup's own machinery and .memev is local
// state (git-ignored), so neither is part of the tree the backup holds.
const tree = (root) => {
  const out = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === '.memev') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out[path.relative(root, p).split(path.sep).join('/')] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    }
  };
  walk(root);
  return out;
};

// A local bare repository the vault pushes to: the git backup, the path the relay falls back to.
const gitBackup = (root) => {
  const bare = path.join(root, '..', 'backup.git');
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', bare]);
  execFileSync('git', ['remote', 'add', 'origin', `file://${bare}`], { cwd: root });
};

test('WO-06-A AC01: with the relay switched off, the next sync runs through the git backup and the vault tree is byte for byte unchanged', () => {
  const { root, v } = newVault();
  gitBackup(root);
  v.remember(OWNER, { text: 'the kettle is blue', kind: 'fact' });
  // the vault was using the relay
  setRelay(root, { enabled: true, url: 'relay://127.0.0.1:9', domain: 'relay.test' });
  const base = syncOnce(v, { root });
  assert.equal(base.remote, 'origin', `baseline sync: ${base.error}`);
  assert.equal(base.pushed, true, `baseline push: ${base.error}`);
  const before = tree(root);
  // switch the relay off
  setRelay(root, { enabled: false });
  assert.equal(relaySetting(root).enabled, false, 'the relay is still on after switching it off');
  // the next sync still runs through the git backup provider
  assert.equal(selectProvider('sync', { root, config: v.config }).id, 'git', 'the sync provider is no longer the git backup');
  const res = syncOnce(v, { root });
  assert.equal(res.remote, 'origin', `sync after the relay went off: ${res.error}`);
  assert.equal(res.pushed, true, `push after the relay went off: ${res.error}`);
  // the vault tree is byte for byte what it was: nothing removed, nothing rewritten
  assert.deepEqual(tree(root), before, 'the vault tree changed when the relay was switched off');
  v.close();
});

test('WO-06-A AC02: the doctor names the relay off on the backup check line, and the line never reaches a session context', () => {
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
  // the line never reaches a session's context: not the resume card, not the protocol
  const card = renderCard(v.sessionStart(OWNER, { task: 'check the backup' }));
  assert.doesNotMatch(card, /the relay is off/, 'the relay-off line reached the resume card');
  assert.doesNotMatch(PROTOCOL + PROTOCOL_POINTER, /the relay is off/, 'the relay-off line reached the protocol');
  v.close();
});

test('WO-06-A AC03: with the relay configured and unreachable, the client reports the failure, waits a growing pause, and never blocks the other jobs', async () => {
  const { root, v } = newVault();
  const port = freePort(); // nothing listens here, so the relay is unreachable
  const retries = [];
  const client = startRelayClient({
    root, port: 0, url: `relay://127.0.0.1:${port}`, domain: 'relay.test',
    onState: (s) => { if (s.state === 'cannot reach the relay (retrying)') retries.push(Date.now()); },
  });
  // a background job that must keep running while the relay retries
  let jobs = 0;
  const job = setInterval(() => { jobs++; }, 20);
  await new Promise((r) => setTimeout(r, 2400));
  client.stop();
  clearInterval(job);
  v.close();
  // the client reported the failure
  assert.ok(retries.length >= 2, `expected at least two retry reports, got ${retries.length}`);
  // the pause grows before each retry (half a second, then double)
  const gaps = retries.slice(1).map((t, i) => t - retries[i]);
  assert.ok(gaps.length >= 1, `expected a gap between retries, got ${retries.length} reports`);
  if (gaps.length >= 2) assert.ok(gaps[1] > gaps[0], `the pause should grow before each retry: ${gaps.join(', ')} ms`);
  // the other background jobs kept running: the relay retries never block the event loop
  assert.ok(jobs > 30, `the background jobs kept running: ${jobs} ticks in ~2.4 s`);
});
