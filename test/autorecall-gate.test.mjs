// The per-prompt recall bar: short and continuation prompts are not recalled, the hook injects only hits at or above
// its bar, memev_recall keeps returning weaker hits, and the bar is the value the benchmark sweep justified.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { sandbox, BIN } from './helpers/cli.mjs';
import { newVault, cleanup, PKG, OWNER, tmpdir } from './helpers/tmp.mjs';
import { createServer, HOOK_BAR, hookMinScore } from '../src/server/http.mjs';
import { handle } from '../src/server/mcp.mjs';

after(() => cleanup());
const targets = JSON.parse(fs.readFileSync(path.join(PKG, 'bench', 'targets.json'), 'utf8'));
const baseline = JSON.parse(fs.readFileSync(path.join(PKG, 'bench', 'baseline.json'), 'utf8'));

// the hook as an app runs it, without blocking this process (a stand-in daemon here has to answer it)
const hook = (sb, prompt) => new Promise((resolve) => {
  const p = spawn(process.execPath, [BIN, 'hook', 'prompt', '--client', 'claude-code', '--project', 'billing'], { env: sb.env });
  let out = ''; p.stdout.on('data', (d) => { out += d; });
  p.on('close', (code) => resolve({ code, out }));
  p.stdin.end(JSON.stringify({ session_id: 'gate', prompt }));
});

test('MEM-111 AC03: Prompts under 4 words and the continuation list inject nothing and make no recall call', async () => {
  const sb = sandbox();
  let server;
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
    assert.equal(sb.run(['stop']).code, 0);
    // a stand-in daemon for this vault that records every route the hook calls, and would inject on a recall
    const { vault_id } = JSON.parse(fs.readFileSync(path.join(sb.root, '.memev', 'config.json'), 'utf8'));
    const routes = [];
    server = http.createServer((req, res) => {
      routes.push(req.url);
      req.resume(); req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        if (req.url === '/healthz') return res.end(JSON.stringify({ ok: true, name: 'memev', vault_id }));
        if (req.url === '/v1/recall') return res.end(JSON.stringify({ hits: [{ path: 'memory/facts/2026-10.md', heading: 'h', score: 9 }], text: '[Memev recall for this prompt]\n- [memory/facts/2026-10.md#h] the webhook retry note' }));
        return res.end('{}');
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    fs.writeFileSync(path.join(sb.root, '.memev', 'daemon.json'), JSON.stringify({ pid: process.pid, port: server.address().port, bind: '127.0.0.1', started: new Date().toISOString(), root: sb.root }));
    for (const prompt of ['continue', 'go on', 'yes', 'ok', 'thanks', 'fix it', 'do it', 'make this async', 'Go ahead.']) {
      routes.length = 0;
      const r = await hook(sb, prompt);
      assert.equal(r.code, 0);
      assert.equal(r.out, '', `${prompt}: nothing injected`);
      assert.ok(routes.includes('/v1/journal'), `${prompt}: the prompt is still recorded (${routes})`);
      assert.equal(routes.includes('/v1/recall'), false, `${prompt}: no recall call (${routes})`);
    }
    // a real question is recalled, and what the stand-in returns is injected
    routes.length = 0;
    const r = await hook(sb, 'how do we handle retries for webhook delivery');
    assert.ok(routes.includes('/v1/recall'), String(routes));
    assert.match(JSON.parse(r.out).hookSpecificOutput.additionalContext, /the webhook retry note/);
  } finally {
    // daemon.json names this process; memev stop would end it
    fs.rmSync(path.join(sb.root, '.memev', 'daemon.json'), { force: true });
    server?.close(); sb.stop();
  }
});

test('MEM-111 AC04: The hook minimum score is in the range 6 to 8 or a documented relative rule, and the tool path threshold is unchanged', async () => {
  // the rule: a share of the largest score one rare word can add in the vault, documented in http.mjs and targets.json
  assert.equal(targets.hook_bar.value, HOOK_BAR, 'bench/targets.json records the share in use');
  assert.match(targets.hook_bar.rule, /share of ln\(1 \+ \(sections - 0\.5\) \/ 1\.5\)/);
  const at = (sections, recall = { min_score: 1 }) => hookMinScore({ config: { recall }, index: { docs: { size: sections } } });
  // at both benchmark sizes the bar falls inside 6 to 8
  for (const n of [2598, 6598]) assert.ok(at(n) >= 6 && at(n) <= 8, `${n} sections: ${at(n)}`);
  assert.ok(at(30) < at(2598) && at(30) >= 1, 'a small vault gets a lower bar, never under recall.min_score');
  assert.equal(at(2598, { hook_min_score: 6.5 }), 6.5, 'recall.hook_min_score sets a fixed bar');
  assert.equal(at(2598, { min_score: 9 }), 9, 'a higher recall.min_score still wins');
  // the tool path keeps no bar: with the hook bar set out of reach, memev_recall still returns the hit and the hook gets none
  const { v } = newVault();
  v.config.recall = { ...v.config.recall, hook_min_score: 1000 };
  v.remember(OWNER, { text: 'The deploy pipeline for billing runs nightly at 02:00 UTC, after the ledger snapshot finishes.', kind: 'fact', force: true });
  const r = await handle(v, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memev_recall', arguments: { query: 'deploy pipeline' } } }, { identity: OWNER, client: 'test', local: true });
  const hits = JSON.parse(r.result.content[0].text);
  assert.ok(hits.some((h) => h.snippet.includes('deploy pipeline') && h.score < 1000), JSON.stringify(hits));
  const server = createServer(v);
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  try {
    const token = v.tokens.issue({ agent: 'claude-code' }).token;
    const route = await (await fetch(`http://127.0.0.1:${server.address().port}/v1/recall`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ query: 'deploy pipeline', limit: 4 }) })).json();
    assert.deepEqual(route.hits, [], 'the hook gets nothing below its bar');
    assert.equal(route.text, '');
  } finally { server.close(); v.close(); }
});

test('MEM-111 AC05: Hook recall@4 on the labelled on-topic prompts is not lower than the 18abe10 baseline at either size', () => {
  for (const level of ['small', 'large']) {
    const out = path.join(tmpdir('gate-'), `${level}.json`);
    const r = spawnSync(process.execPath, [path.join(PKG, 'scripts', 'bench', 'run.mjs'), '--level', level, '--json', out], { cwd: PKG, encoding: 'utf8', timeout: 300000 });
    assert.equal(r.status, 0, r.stderr);
    const m = JSON.parse(fs.readFileSync(out, 'utf8')).quality, b = baseline.levels[level].quality;
    assert.ok(m.recall_at_4 >= b.recall_at_4, `${level}: recall@4 ${m.recall_at_4} against ${b.recall_at_4} at 18abe10`);
    assert.ok(m.counts.found_at_4 >= b.counts.found_at_4, `${level}: ${m.counts.found_at_4} hits against ${b.counts.found_at_4}`);
  }
});

test('MEM-111 AC06: The chosen value is recorded in bench/targets.json with the sweep that justified it', () => {
  const h = targets.hook_bar;
  assert.equal(h.value, HOOK_BAR);
  assert.equal(h.contract, 'MEM-111');
  const rows = h.sweep;
  for (const level of ['small', 'large']) {
    const at = rows.find((x) => x.level === level && x.hook_bar === h.value);
    assert.ok(at, `the chosen share was measured at ${level}`);
    assert.equal(at.found_at_4, baseline.levels[level].quality.counts.found_at_4, `${level}: no on-topic hit lost at the chosen share`);
  }
  // every higher share in the sweep loses a hit somewhere, so the chosen one is the highest that does not
  const higher = rows.filter((r) => r.hook_bar > h.value);
  assert.ok(higher.length, 'the sweep goes above the chosen share');
  for (const x of higher) {
    const loses = ['small', 'large'].some((level) => (rows.find((r) => r.level === level && r.hook_bar === x.hook_bar)?.found_at_4 ?? Infinity) < baseline.levels[level].quality.counts.found_at_4);
    assert.ok(loses, `share ${x.hook_bar} keeps every hit, so ${h.value} is not the highest`);
  }
});
