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
import { createServer, HOOK_MIN_SCORE, hookMinScore } from '../src/server/http.mjs';
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
  assert.ok(HOOK_MIN_SCORE >= 6 && HOOK_MIN_SCORE <= 8, String(HOOK_MIN_SCORE));
  assert.equal(targets.hook_min_score.value, HOOK_MIN_SCORE, 'bench/targets.json records the bar in use');
  assert.equal(hookMinScore({ recall: { min_score: 1 } }), HOOK_MIN_SCORE, 'an existing vault (min_score 1.0 in its config) gets the new bar');
  assert.equal(hookMinScore({ recall: { hook_min_score: 6.5 } }), 6.5);
  assert.equal(hookMinScore({ recall: { min_score: 9 } }), 9, 'a higher bar set by the user still wins');
  // a weak match: memev_recall returns it, the per-prompt route leaves it out
  const { v } = newVault();
  v.remember(OWNER, { text: 'The deploy pipeline for billing runs nightly at 02:00 UTC, after the ledger snapshot finishes.', kind: 'fact', force: true });
  const r = await handle(v, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memev_recall', arguments: { query: 'deploy' } } }, { identity: OWNER, client: 'test', local: true });
  const hits = JSON.parse(r.result.content[0].text);
  const weak = hits.find((h) => h.snippet.includes('deploy pipeline'));
  assert.ok(weak && weak.score > 0 && weak.score < HOOK_MIN_SCORE, JSON.stringify(hits));
  const server = createServer(v);
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  try {
    const token = v.tokens.issue({ agent: 'claude-code' }).token;
    const route = await (await fetch(`http://127.0.0.1:${server.address().port}/v1/recall`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ query: 'deploy', limit: 4 }) })).json();
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
  const h = targets.hook_min_score;
  assert.equal(h.value, HOOK_MIN_SCORE);
  assert.equal(h.contract, 'MEM-111');
  const rows = h.sweep;
  assert.ok(rows.every((x) => x.hook_min_score >= 6 && x.hook_min_score <= 8), 'the sweep stays in 6 to 8');
  for (const level of ['small', 'large']) {
    const at = rows.find((x) => x.level === level && x.hook_min_score === h.value);
    assert.ok(at, `the chosen value was measured at ${level}`);
    assert.equal(at.found_at_4, baseline.levels[level].quality.counts.found_at_4, `${level}: no on-topic hit lost at the chosen value`);
  }
  // every higher value in the sweep loses a hit somewhere, so the chosen one is the highest that does not
  for (const x of rows.filter((r) => r.hook_min_score > h.value)) {
    const loses = ['small', 'large'].some((level) => (rows.find((r) => r.level === level && r.hook_min_score === x.hook_min_score)?.found_at_4 ?? Infinity) < baseline.levels[level].quality.counts.found_at_4);
    assert.ok(loses, `bar ${x.hook_min_score} keeps every hit, so ${h.value} is not the highest`);
  }
});
