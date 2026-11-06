// SPDX-License-Identifier: Apache-2.0
// What the fast index has to keep, seen from outside it: the prompt hook's page, a note changed while stopped, a write just before a
// hard kill, the one conversion of an old index, and the figures the daemon reports about itself.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { Vault } from '../src/engine/vault.mjs';
import { RecallIndex } from '../src/engine/index.mjs';
import { createServer } from '../src/server/http.mjs';
import { newVault, cleanup, OWNER, PKG } from './helpers/tmp.mjs';
import { clientToken } from '../src/cli/common.mjs';
after(cleanup);

const open = (root, o = {}) => new Vault(root, { git: false, fsync: false, ...o }).open();
const found = (v, q, p) => v.recall(OWNER, { query: q, log: false, all_projects: true }).some((h) => h.path === p);

async function hookRecall(v, query) {
  const server = createServer(v); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/v1/recall`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${clientToken(v.root, 'test-hook')}` }, body: JSON.stringify({ query }) });
    assert.equal(r.status, 200); return await r.json();
  } finally { await new Promise((res) => server.close(res)); }
}

test('the prompt hook leaves past journals out before ranking, so a prompt asked before still gets its memory', async () => {
  const { v } = newVault();
  const ask = 'how does webhook delivery retry in billing';
  for (let i = 0; i < 40; i++) v.write(OWNER, { path: `notes/other${i}.md`, body: `# Other ${i}\nsomething else entirely about item ${i}\n` }); // so these words are rare, as in a used vault
  v.remember(OWNER, { text: 'Webhook delivery in billing retries with jittered backoff capped at 60 seconds.', kind: 'decision', force: true });
  // the same words in more journal sections than the page holds: ranked first they fill the top 4, and dropped afterwards they leave it empty
  for (let i = 0; i < 6; i++) v.append(OWNER, { path: `work/sessions/2026-11-0${i + 1}-s${i}.md`, text: `### ${i}\n${ask} ${ask} ${ask}\n` });
  assert.equal(v.recall(OWNER, { query: ask, limit: 4, log: false }).every((h) => h.path.startsWith('work/sessions/')), true, 'the control: unfiltered, journals take the whole page');
  // once with the journals in the overlay, once folded into the segment
  for (const where of ['overlay', 'segment']) {
    const got = await hookRecall(v, ask);
    assert.ok(got.hits.some((h) => h.path.startsWith('memory/decisions/')), `${where}: the memory reached the hook; got ${JSON.stringify(got.hits.map((h) => h.path))}`);
    assert.equal(got.hits.some((h) => h.path.startsWith('work/sessions/')), false, `${where}: no past journal reached the hook`);
    v.index.save(); v.index.compact(); assert.equal(v.index.ov.docs.size, 0);
  }
  v.close();
});

test('a body cannot pass a filter of its own to the recall route', async () => {
  const { v } = newVault();
  v.remember(OWNER, { text: 'The nightly export runs on the warehouse replica at two.', kind: 'fact', force: true });
  const server = createServer(v); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const r = await fetch(`http://127.0.0.1:${server.address().port}/v1/recall`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${clientToken(v.root, 'test-hook')}` }, body: JSON.stringify({ query: 'nightly export warehouse', dropPath: 'x' }) });
  await new Promise((res) => server.close(res)); assert.equal(r.status, 200);
  assert.equal((await r.json()).hits.length > 0, true);
  v.close();
});

test('a note added or edited while stopped reaches recall at the next start', () => {
  const { root, v } = newVault();
  v.write(OWNER, { path: 'notes/kept.md', body: '# Kept\nthe zebrafish protocol stays as it was\n' });
  v.close();
  fs.writeFileSync(path.join(root, 'notes', 'added.md'), '# Added\nquokka census done while nothing ran\n');
  fs.writeFileSync(path.join(root, 'notes', 'kept.md'), '# Kept\nthe axolotl protocol replaced it while nothing ran\n');
  const v2 = open(root);
  assert.equal(found(v2, 'zebrafish', 'notes/kept.md'), false, 'the old words are gone');
  assert.equal(found(v2, 'axolotl', 'notes/kept.md'), true, 'the edited note is found by its new words');
  assert.equal(found(v2, 'quokka', 'notes/added.md'), true, 'the new note is found');
  v2.close();
  const v3 = open(root); assert.equal(found(v3, 'axolotl', 'notes/kept.md'), true, 'and again after a clean restart'); v3.close();
});

// A real process and a real SIGKILL: nothing in this process's memory can help the reopen.
function writeThenKill(root, script) {
  const run = `import { Vault } from ${JSON.stringify(path.join(PKG, 'src/engine/vault.mjs'))};
const v = new Vault(${JSON.stringify(root)}, { git: false, fsync: false }).open();
const OWNER = ${JSON.stringify(OWNER)};
${script}
console.log('written'); setInterval(() => {}, 1000);`;
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ['--input-type=module', '-e', run], { stdio: ['ignore', 'pipe', 'inherit'] });
    c.stdout.on('data', (d) => { if (String(d).includes('written')) c.kill('SIGKILL'); });
    c.on('error', reject); c.on('exit', () => resolve());
  });
}

test('a write just before a hard kill reaches recall at the next start', async () => {
  const { root, v } = newVault();
  v.write(OWNER, { path: 'notes/a.md', body: '# A\nfirst words about a capybara\n' }); v.close();
  const v1 = open(root); v1.close(); // a clean stop has recorded where the index stands
  await writeThenKill(root, "v.write(OWNER, { path: 'notes/b.md', body: '# B\\nwords about a pangolin\\n' }); v.remember(OWNER, { text: 'The tapir migration finished before the freeze this week.', kind: 'fact', force: true });");
  const v2 = open(root);
  assert.equal(found(v2, 'capybara', 'notes/a.md'), true, 'the old note is there');
  assert.equal(found(v2, 'pangolin', 'notes/b.md'), true, 'the new note is found');
  assert.equal(v2.recall(OWNER, { query: 'tapir migration', log: false }).length > 0, true, 'the memory is found');
  v2.close();
});

test('a write before a hard kill reaches recall even when the vault has never stopped cleanly', async () => {
  const { root } = newVault();
  await writeThenKill(root, "v.write(OWNER, { path: 'notes/b.md', body: '# B\\nwords about a numbat\\n' });");
  const v2 = open(root); assert.equal(found(v2, 'numbat', 'notes/b.md'), true); v2.close();
});

test('a journal the retention moved to the archive stays out of recall through a later start', () => {
  const { root, v } = newVault();
  v.config.journal = { ...v.config.journal, retention_days: 1 };
  v.write(OWNER, { path: 'work/sessions/2020-01-01-old.md', body: '# Old\nwords about a wombat\n' });
  assert.equal(found(v, 'wombat', 'work/sessions/2020-01-01-old.md'), true, 'the control: found before the move');
  v.compact(); assert.equal(found(v, 'wombat', 'work/sessions/2020-01-01-old.md'), false, 'out after the move');
  v.close();
  const v2 = open(root); assert.equal(found(v2, 'wombat', 'work/sessions/2020-01-01-old.md'), false, 'still out after a start'); v2.close();
});

test('an old index converts once: same answers, the old file goes, and a kill before the end starts over', () => {
  const { root, v } = newVault();
  v.write(OWNER, { path: 'notes/a.md', body: '# A\nProject: farm\nwords about a capybara\n\n## Later\nreview-by: 2099-01-01\nmore about a capybara herd\n' });
  v.write(OWNER, { path: 'notes/b.md', body: '# B\nwords about a pangolin\n' });
  const before = v.recall(OWNER, { query: 'capybara pangolin', log: false, all_projects: true }).map((h) => [h.path, h.heading, h.line, h.score, h.snippet, h.review_by]);
  v.close();
  // what the last version left: one index file, no segment, no position
  const state = path.join(root, '.memev'), file = path.join(state, 'index.jsonl');
  const old = new RecallIndex(file);
  for (const p of ['notes/a.md', 'notes/b.md']) old.update(p, fs.readFileSync(path.join(root, p), 'utf8'));
  for (const n of open(root).allNotes()) if (!old.byPath.has(n)) old.update(n, fs.readFileSync(path.join(root, n), 'utf8'));
  old.dirty = true; old.save();
  fs.rmSync(path.join(state, 'index.seg'), { recursive: true, force: true }); fs.rmSync(path.join(state, 'index.seq'), { force: true });
  // a kill in the conversion leaves a half folder and no CURRENT
  fs.mkdirSync(path.join(state, 'index.seg', 'gen-9'), { recursive: true }); fs.writeFileSync(path.join(state, 'index.seg', 'gen-9', 'ids.bin'), 'half');
  const v2 = open(root);
  assert.equal(fs.existsSync(file), false, 'the old file is gone once the segment is published');
  assert.ok(fs.existsSync(path.join(state, 'index.seg', 'CURRENT')));
  assert.deepEqual(v2.recall(OWNER, { query: 'capybara pangolin', log: false, all_projects: true }).map((h) => [h.path, h.heading, h.line, h.score, h.snippet, h.review_by]), before, 'the same answers');
  const gen = fs.readFileSync(path.join(state, 'index.seg', 'CURRENT'), 'utf8'); v2.close();
  const v3 = open(root); assert.equal(fs.readFileSync(path.join(state, 'index.seg', 'CURRENT'), 'utf8'), gen, 'it converts once'); v3.close();
});

test('after a downgrade and an upgrade again, the index the older version kept is the one converted, and a journal it archived stays out', () => {
  const { root, v } = newVault();
  v.write(OWNER, { path: 'notes/a.md', body: '# A\nwords about a capybara\n' }); v.write(OWNER, { path: 'work/sessions/2020-01-01-old.md', body: '# Old\nwords about a wombat\n' }); v.close();
  const state = path.join(root, '.memev'), file = path.join(state, 'index.jsonl');
  // the older version ran: it kept its own file, wrote a note, and moved the old journal to the archive without a log record
  const old = new RecallIndex(file); old.update('notes/a.md', fs.readFileSync(path.join(root, 'notes/a.md'), 'utf8')); old.dirty = true; old.save();
  fs.mkdirSync(path.join(root, 'work/archive/sessions'), { recursive: true }); fs.renameSync(path.join(root, 'work/sessions/2020-01-01-old.md'), path.join(root, 'work/archive/sessions/2020-01-01-old.md'));
  const v2 = open(root);
  assert.equal(found(v2, 'capybara', 'notes/a.md'), true); assert.equal(found(v2, 'wombat', 'work/sessions/2020-01-01-old.md'), false, 'the archived journal stays out');
  assert.equal(fs.existsSync(file), false); v2.close();
});

test('a note the old index never saw reaches recall through the conversion, as a hard kill before the upgrade leaves it', () => {
  const { root, v } = newVault();
  v.write(OWNER, { path: 'notes/a.md', body: '# A\nwords about a capybara\n' }); v.write(OWNER, { path: 'notes/c.md', body: '# C\nwords about a tapir\n' }); v.close();
  const state = path.join(root, '.memev'), file = path.join(state, 'index.jsonl');
  const old = new RecallIndex(file); old.update('notes/a.md', fs.readFileSync(path.join(root, 'notes/a.md'), 'utf8')); old.dirty = true; old.save();
  const past = Date.now() / 1000 - 3600; fs.utimesSync(file, past, past);
  fs.rmSync(path.join(state, 'index.seg'), { recursive: true, force: true }); fs.rmSync(path.join(state, 'index.seq'), { force: true });
  const v2 = open(root); assert.equal(found(v2, 'capybara', 'notes/a.md'), true); assert.equal(found(v2, 'tapir', 'notes/c.md'), true); v2.close();
});

test('the daemon reports what it measured, and says what it did not', async () => {
  const { v } = newVault();
  const empty = v.status().health;
  assert.ok(empty.start_ms >= 0); assert.equal(empty.recall.p50_ms, null, 'no recall yet, so no figure'); assert.equal(empty.longest_save_block_ms, null);
  assert.equal(empty.prompts.skipped_for_time, null); assert.deepEqual(empty.not_measured, ['prompts.skipped_for_time']);
  v.remember(OWNER, { text: 'The nightly export runs on the warehouse replica at two.', kind: 'fact', force: true });
  await hookRecall(v, 'nightly export warehouse'); await hookRecall(v, 'qqqxxx');
  const h = v.status().health;
  assert.equal(h.recall.count, 2); assert.ok(h.recall.p50_ms >= 0 && h.recall.p95_ms >= h.recall.p50_ms);
  assert.equal(h.prompts.with_memory, 1); assert.equal(h.prompts.without_memory, 1);
  assert.ok(h.memory.rss_mb > 0);
  await new Promise((r) => setTimeout(r, 3300)); // the debounced save
  assert.ok(v.status().health.longest_save_block_ms >= 0, 'a save was timed');
  v.close();
});

test('status says a daemon is loading rather than not running', { skip: process.platform === 'win32' }, async () => {
  const { root, v } = newVault(); v.close();
  // a process that is a daemon to anyone who looks: a pid in that file alone proves nothing (see index-damage.test.mjs)
  const stub = path.join(root, '..', 'server', 'main.mjs'); fs.mkdirSync(path.dirname(stub), { recursive: true }); fs.writeFileSync(stub, 'setTimeout(() => {}, 30000);');
  const keep = spawn(process.execPath, [stub, '--root', root], { stdio: 'ignore' }); await new Promise((r) => keep.once('spawn', r));
  try {
    fs.writeFileSync(path.join(root, '.memev', 'daemon.loading'), JSON.stringify({ pid: keep.pid }));
    const bin = path.join(PKG, 'bin', 'memev.mjs');
    // what doctor and the hook say comes from this one, which memev status does not use
    const { whyNotRunning } = await import('../src/cli/daemon.mjs'); assert.match(String(await whyNotRunning(root)), /still loading/);
    const text = spawnSync(process.execPath, [bin, 'status', '--root', root], { encoding: 'utf8' });
    assert.match(text.stdout, /still loading/, text.stdout + text.stderr);
    const json = spawnSync(process.execPath, [bin, 'status', '--json', '--root', root], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(json.stdout), { running: false, loading: true, pid: keep.pid });
  } finally { keep.kill('SIGKILL'); }
});
