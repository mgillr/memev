// SR-1.01 task 3: the daemon and the CLI openers live with the vault lock (src/engine/oplog.mjs, task 1). The daemon meets a held
// lock with exit code 5, `memev start` says who holds the vault, claims and doctor read without the lock, compact takes it, doctor
// names a held lock, and the login units do not restart a daemon that a held lock refused. Every subtest name starts with its
// criterion's label (T3-cNN:) so the signed criterion can run it alone.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanup } from './helpers/tmp.mjs';
import { renderUnit } from '../src/cli/service.mjs';
import { stopDaemon } from '../src/cli/daemon.mjs';
import { initSandbox, seed, notePath, snapshot, records, holder, sleeper, rawDaemon, waitHealthy, answers, httpWrite, holdPort, stealLock, pollFor, killAll, alive, sleep } from './helpers/oplog-lock-cli.mjs';
import { Vault } from '../src/engine/vault.mjs';

after(() => { killAll(); cleanup(); });
const boxes = [];
const box = (opts) => { const sb = initSandbox(opts); boxes.push(sb); return sb; };
afterEach(() => { killAll(); for (const sb of boxes.splice(0)) sb.stop(); });

// a daemon or a child that hangs fails its test instead of holding the run
const t = (name, fn) => test(name, { timeout: 180000 }, fn);
const both = (r) => `${r.out}${r.err}`;
/** Open the vault read-only, as a reader that holds no lock, and check the log. */
const verify = (sb) => { const v = new Vault(sb.root, { git: false, readOnly: true }).open(); try { const r = v.log.verify(); return { ok: r.ok, ops: r.ops, errors: r.errors }; } finally { v.close(); } };
const seqs = (sb) => records(sb.oplog).map((r) => r.seq);
const consecutive = (xs) => xs.every((s, i) => s === i + 1);
const startRecords = (sb) => records(sb.oplog).filter((r) => r.client === 'startup').length;

t('T3-c01: the daemon meets a held lock with exit code 5 within 2 s and no daemon.lock; memev start names the holder; a free vault starts', async () => {
  const sb = box();
  const h = await holder(sb);
  const d = rawDaemon(sb);
  const { code, ms } = await d.exitedWithin(10000);
  assert.equal(code, 5, d.stderr());
  assert.ok(ms < 2000, `the daemon ended in ${ms} ms`);
  assert.match(d.stderr(), /VaultLocked/);
  assert.match(d.stderr(), new RegExp(`pid ${h.pid}\\b`));
  assert.doesNotMatch(d.stderr(), /\n\s+at /, 'no stack trace');
  assert.equal(fs.existsSync(path.join(sb.state, 'daemon.lock')), false, 'no daemon.lock is left behind');
  assert.equal(fs.existsSync(path.join(sb.state, 'daemon.json')), false);
  const s = sb.run(['start']);
  assert.equal(s.code, 1, both(s));
  assert.match(both(s), new RegExp(`locked by pid ${h.pid}\\b`));
  assert.doesNotMatch(both(s), /did not start/);
  assert.equal(fs.existsSync(path.join(sb.state, 'daemon.lock')), false);
  await h.stop();
  const ok = sb.run(['start']);
  assert.equal(ok.code, 0, both(ok));
  assert.equal(await waitHealthy(sb, 3000), true, 'the daemon is up after the holder is gone');
  assert.equal(verify(sb).ok, true);
});

t('T3-c02: memev claims reads without the lock while the daemon is starting and with it stopped, and the daemon still comes up', async () => {
  const sb = box();
  seed(sb);
  // a daemon that is starting holds the vault's lock and does not answer yet: a holder stands in for it
  const h = await holder(sb);
  const before = snapshot(sb.oplog);
  const during = sb.run(['claims', '--json']);
  assert.equal(during.code, 0, both(during));
  assert.deepEqual(snapshot(sb.oplog), before, 'the op log is byte-identical after claims beside a starting daemon');
  await h.stop();
  // the real daemon starts while two claims run against it
  const d = rawDaemon(sb);
  const runs = await Promise.all([sb.runAsync(['claims', '--json']), sb.runAsync(['claims', '--json'])]);
  for (const r of runs) assert.equal(r.code, 0, both(r));
  assert.equal(await waitHealthy(sb, 10000), true, 'claims did not stop the daemon from coming up');
  assert.equal(alive(d.pid), true);
  assert.equal(sb.run(['stop']).code, 0);
  // stopped
  const stopped = snapshot(sb.oplog);
  const off = sb.run(['claims', '--json']);
  assert.equal(off.code, 0, both(off));
  assert.deepEqual(snapshot(sb.oplog), stopped, 'the op log is byte-identical after claims with the daemon stopped');
  assert.equal(fs.existsSync(sb.lock), false, 'no lock is left behind');
});

t('T3-c03: with a live daemon memev compact refuses with VaultLocked naming its pid and changes nothing; doctor without --fix exits 0 and changes nothing', () => {
  const sb = box();
  assert.equal(sb.run(['start']).code, 0);
  const pid = JSON.parse(fs.readFileSync(path.join(sb.state, 'daemon.json'), 'utf8')).pid;
  const before = snapshot(sb.oplog);
  const c = sb.run(['compact']);
  assert.notEqual(c.code, 0, both(c));
  assert.match(both(c), /VaultLocked/);
  assert.match(both(c), new RegExp(`pid ${pid}\\b`));
  assert.deepEqual(snapshot(sb.oplog), before, 'compact changed the op log');
  const d = sb.run(['doctor']);
  assert.equal(d.code, 0, both(d));
  assert.deepEqual(snapshot(sb.oplog), before, 'doctor changed the op log');
});

t('T3-c08: compact guards on the lock, not on daemon.json: a held lock is refused cleanly; a live process in daemon.json is not a daemon', async () => {
  const sb = box();
  seed(sb, { notes: 60, segmentBytes: 512 });
  // (a) a child holds the vault, no daemon.json
  const h = await holder(sb);
  assert.equal(fs.existsSync(path.join(sb.state, 'daemon.json')), false);
  const before = snapshot(sb.oplog);
  const a = sb.run(['compact']);
  assert.notEqual(a.code, 0, both(a));
  assert.match(both(a), /VaultLocked/);
  assert.match(both(a), new RegExp(`pid ${h.pid}\\b`));
  assert.doesNotMatch(both(a), /\n\s+at /, 'no stack trace');
  assert.deepEqual(snapshot(sb.oplog), before);
  await h.stop();
  // (b) daemon.json names a live process that is not a daemon, and no lock is held
  const s = sleeper();
  fs.writeFileSync(path.join(sb.state, 'daemon.json'), JSON.stringify({ pid: s.pid, port: sb.port, bind: '127.0.0.1', started: new Date().toISOString(), root: sb.root }), { mode: 0o600 });
  const b = sb.run(['compact']);
  assert.equal(b.code, 0, both(b));
  const archived = fs.existsSync(path.join(sb.oplog, 'archive')) ? fs.readdirSync(path.join(sb.oplog, 'archive')).filter((f) => f.endsWith('.jsonl')) : [];
  assert.ok(archived.length > 0, 'the sealed segments were archived');
  assert.equal(verify(sb).ok, true);
  s.kill();
});

t('T3-c09: doctor --fix beside a live daemon repairs by HTTP and restart and writes no record from the CLI; a fix the held lock blocks is named', async () => {
  const sb = box();
  seed(sb);
  assert.equal(sb.run(['start']).code, 0);
  fs.chmodSync(path.join(sb.state, 'tokens.json'), 0o644);
  fs.appendFileSync(notePath(sb), 'edited on disk\n');
  const d = sb.run(['doctor', '--fix']);
  assert.equal(d.code, 0, both(d));
  assert.equal(fs.statSync(path.join(sb.state, 'tokens.json')).mode & 0o777, 0o600, 'tokens.json is private again');
  assert.equal(records(sb.oplog).filter((r) => r.client === 'doctor').length, 0, 'the CLI wrote no record');
  assert.equal(verify(sb).ok, true);
  assert.equal(sb.run(['stop']).code, 0);
  // no daemon, a child holds the vault, a note was edited: the repair needs the vault, so it is named, with the holder
  const h = await holder(sb);
  fs.appendFileSync(notePath(sb), 'edited again\n');
  const before = snapshot(sb.oplog);
  const f = sb.run(['doctor', '--fix']);
  const text = both(f);
  assert.match(text, /VaultLocked/);
  assert.match(text, new RegExp(`pid ${h.pid}\\b`));
  assert.match(text, /stop/i);
  assert.deepEqual(snapshot(sb.oplog), before, 'the CLI wrote nothing to the op log');
  assert.equal(records(sb.oplog).filter((r) => r.client === 'doctor').length, 0);
  await h.stop();
});

t('T3-c10: a port held by another program and a held lock are told apart, and their exit codes differ', async () => {
  const sb = box();
  const port = await holdPort(sb.port);
  const p = sb.run(['start']);
  assert.equal(p.code, 1, both(p));
  assert.match(both(p), new RegExp(`\\b${sb.port}\\b`), 'names the port');
  assert.doesNotMatch(both(p), /locked|VaultLocked/i);
  const d4 = rawDaemon(sb);
  const four = (await d4.exitedWithin(10000)).code;
  assert.equal(fs.existsSync(sb.lock), false, 'a daemon that could not listen released the vault lock');
  await port.close();
  const h = await holder(sb);
  const l = sb.run(['start']);
  assert.equal(l.code, 1, both(l));
  assert.match(both(l), /VaultLocked/);
  assert.match(both(l), new RegExp(`pid ${h.pid}\\b`));
  assert.doesNotMatch(both(l), new RegExp(`\\b${sb.port}\\b`), 'does not mention the port');
  const d5 = rawDaemon(sb);
  const five = (await d5.exitedWithin(10000)).code;
  assert.equal(four, 4, 'cannot listen');
  assert.equal(five, 5, 'vault locked');
  assert.notEqual(four, five);
  await h.stop();
});

t('T3-c11: a daemon that loses the lock refuses the write, exits with the VaultLocked code within 2 s, and comes back when the lock is free', async () => {
  const sb = box();
  const d = rawDaemon(sb, { MEMEV_LOCK_RENEW_MS: '200' });
  assert.equal(await waitHealthy(sb, 10000), true, d.stderr());
  const ok = await httpWrite(sb, 'notes/before.md');
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const lost = stealLock(sb);
  const t0 = Date.now();
  const refused = await httpWrite(sb, 'notes/refused.md');
  assert.notEqual(refused.status, 200, 'the write is refused');
  const { code } = await d.exitedWithin(2000);
  assert.equal(code, 5, d.stderr());
  assert.ok(Date.now() - t0 < 2000, `the daemon exited ${Date.now() - t0} ms after the lock was taken`);
  assert.equal(fs.readFileSync(sb.lock, 'utf8'), lost, 'the lock still holds the other holder\'s bytes');
  assert.equal(records(sb.oplog).some((r) => r.path === 'notes/refused.md'), false, 'the refused write is not in the log');
  fs.rmSync(sb.lock);
  const s = sb.run(['start']);
  assert.equal(s.code, 0, both(s));
  assert.equal(await waitHealthy(sb, 5000), true);
  const again = await httpWrite(sb, 'notes/after.md');
  assert.equal(again.status, 200, JSON.stringify(again.body));
  const v = verify(sb);
  assert.equal(v.ok, true, v.errors?.join('; '));
  assert.ok(consecutive(seqs(sb)), 'seq is consecutive');
});

t('T3-c12: doctor --json names a held lock\'s pid, host and age and exits non-zero; once the holder is gone it reports the lock stale and recoverable', async () => {
  const sb = box();
  const h = await holder(sb);
  const held = sb.run(['doctor', '--json']);
  assert.notEqual(held.code, 0, both(held));
  const checks = JSON.parse(held.out);
  const lock = checks.find((c) => c.id === 'daemon');
  assert.ok(lock, `the daemon check; got ${checks.map((c) => c.id).join(', ')}`);
  assert.equal(lock.status, 'fail');
  assert.match(lock.detail, new RegExp(`pid ${h.pid}\\b`));
  assert.ok(lock.detail.includes(os.hostname()), lock.detail);
  assert.match(lock.detail, /\b\d+ ?s\b/, 'the age in seconds');
  await h.kill9();
  const gone = sb.run(['doctor', '--json']);
  const stale = JSON.parse(gone.out).find((c) => c.id === 'daemon');
  assert.ok(stale, 'the daemon check is still there');
  assert.match(stale.detail, /stale/);
  assert.match(stale.detail, /recoverable/);
  assert.notEqual(stale.status, 'ok');
});

t('T3-c13: doctor without --fix opens read-only: the op log is byte-identical, no LOCK ever appears, and the drift check reports the edited note', async () => {
  const sb = box();
  seed(sb);
  fs.appendFileSync(notePath(sb), 'edited on disk\n');
  fs.writeFileSync(path.join(sb.root, 'notes', 'added-on-disk.md'), 'added on disk\n');
  const before = snapshot(sb.oplog);
  const startBefore = startRecords(sb);
  const poll = await pollFor(sb.lock);
  const r = sb.run(['doctor', '--json']);
  const { seen } = await poll.stop();
  const checks = JSON.parse(r.out);
  assert.deepEqual(snapshot(sb.oplog), before, 'the op log changed');
  assert.equal(startRecords(sb), startBefore, 'no record with client startup was appended');
  assert.equal(records(sb.oplog).filter((x) => x.path === 'notes/added-on-disk.md').length, 0, 'the added note was not imported');
  assert.equal(fs.existsSync(sb.lock), false, 'no LOCK exists afterwards');
  assert.equal(seen, false, 'a child polling every 5 ms never saw a LOCK');
  const drift = checks.find((c) => c.id === 'drift');
  assert.ok(drift, 'the drift check ran');
  assert.equal(drift.status, 'warn');
  assert.match(drift.detail, /^1 note\(s\) changed outside Memev/);
});

t('T3-c14: a daemon that finds its lock taken exits with code 5 within 2 s with no request, stops answering, and leaves the other lock alone', async () => {
  const sb = box();
  const d = rawDaemon(sb, { MEMEV_LOCK_RENEW_MS: '200' });
  assert.equal(await waitHealthy(sb, 10000), true, d.stderr());
  const lost = stealLock(sb);
  const t0 = Date.now();
  const { code } = await d.exitedWithin(2000);
  assert.equal(code, 5, d.stderr());
  assert.ok(Date.now() - t0 < 2000, `exited ${Date.now() - t0} ms after the lock was taken`);
  assert.equal(await answers(sb), false, '/healthz no longer answers');
  assert.equal(fs.readFileSync(sb.lock, 'utf8'), lost, 'LOCK still holds the test\'s bytes');
});

t('T3-c15: the login units do not restart a daemon that a held lock refused', () => {
  const unit = renderUnit('systemd', { launcher: '/x/memev', root: '/v', logFile: '/v/.memev/daemon.log' });
  assert.match(unit, /^RestartPreventExitStatus=5$/m);
  const plist = renderUnit('launchd', { launcher: '/x/memev', root: '/v', logFile: '/v/.memev/daemon.log' });
  const m = /<key>ThrottleInterval<\/key>\s*<integer>(\d+)<\/integer>/.exec(plist);
  assert.ok(m, 'the plist sets ThrottleInterval');
  assert.ok(Number(m[1]) >= 60, `ThrottleInterval is ${m[1]}`);
});

t('stopDaemon leaves the daemon.lock of a live daemon that has not written daemon.json yet', async () => {
  const sb = box();
  const s = sleeper();
  const lockFile = path.join(sb.state, 'daemon.lock');
  fs.writeFileSync(lockFile, String(s.pid), { mode: 0o600 });
  assert.equal(fs.existsSync(path.join(sb.state, 'daemon.json')), false);
  await stopDaemon(sb.root);
  assert.equal(fs.existsSync(lockFile), true, 'a live pid\'s daemon.lock is not deleted');
  s.kill();
  await sleep(100);
  await stopDaemon(sb.root);
  assert.equal(fs.existsSync(lockFile), false, 'a dead pid\'s daemon.lock is removed');
});

t('doctor --fix with no daemon and no holder imports the note edited on disk and the log verifies', () => {
  const sb = box();
  seed(sb);
  fs.appendFileSync(notePath(sb), 'edited on disk\n');
  const r = sb.run(['doctor', '--fix']);
  assert.doesNotMatch(both(r), /could not fix/, both(r));
  const after = JSON.parse(sb.run(['doctor', '--json']).out);
  assert.equal(after.find((c) => c.id === 'drift').status, 'ok');
  assert.equal(verify(sb).ok, true);
});
