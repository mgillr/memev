// Per-prompt recall for prompts written without spaces: a Japanese, Chinese or Thai sentence is not one word, so the
// prompt hook recalls for it, while English continuation phrases and short prompts still do not.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { sandbox, BIN } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';
import { isContinuation } from '../src/cli/hooks.mjs';

after(() => cleanup());

// the hook as an app runs it, against a stand-in daemon that records the routes the hook calls
const hook = (sb, prompt) => new Promise((resolve) => {
  const p = spawn(process.execPath, [BIN, 'hook', 'prompt', '--client', 'claude-code', '--project', 'billing'], { env: sb.env });
  let out = ''; p.stdout.on('data', (d) => { out += d; });
  p.on('close', (code) => resolve({ code, out }));
  p.stdin.end(JSON.stringify({ session_id: 'scripts', prompt }));
});

const standIn = async (sb) => {
  assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
  assert.equal(sb.run(['stop']).code, 0);
  const { vault_id } = JSON.parse(fs.readFileSync(path.join(sb.root, '.memev', 'config.json'), 'utf8'));
  const routes = [];
  const server = http.createServer((req, res) => {
    routes.push(req.url);
    req.resume(); req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url === '/healthz') return res.end(JSON.stringify({ ok: true, name: 'memev', vault_id }));
      if (req.url === '/v1/recall') return res.end(JSON.stringify({ hits: [], text: '' }));
      return res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  fs.writeFileSync(path.join(sb.root, '.memev', 'daemon.json'), JSON.stringify({ pid: process.pid, port: server.address().port, bind: '127.0.0.1', started: new Date().toISOString(), root: sb.root }));
  return { routes, close: async () => { fs.rmSync(path.join(sb.root, '.memev', 'daemon.json'), { force: true }); await new Promise((r) => server.close(r)); } };
};

test('REV-021 AC01: a Japanese, a Chinese and a Thai sentence written without spaces is not a continuation, so the prompt hook recalls for them', async () => {
  const prompts = {
    japanese: '今日は天気がいいです',
    chinese: '今天天气很好我想学习编程',
    thai: 'ฉันต้องการค้นหาข้อมูลในโน้ตของฉัน',
  };
  for (const [lang, p] of Object.entries(prompts)) {
    assert.equal(isContinuation(p), false, `${lang}: a sentence is not a continuation`);
  }
  const sb = sandbox();
  let routes, close;
  try {
    ({ routes, close } = await standIn(sb));
    for (const [lang, p] of Object.entries(prompts)) {
      routes.length = 0;
      const r = await hook(sb, p);
      assert.equal(r.code, 0, `${lang}: the hook exits 0`);
      assert.ok(routes.includes('/v1/recall'), `${lang}: the hook recalls (${routes})`);
    }
  } finally {
    await close?.(); sb.stop();
  }
});

test('REV-021 AC02: English continuation phrases and prompts under four words are still treated as continuations', async () => {
  for (const p of ['continue', 'go on', 'go ahead', 'carry on', 'keep going', 'yes', 'yes please', 'yep', 'yeah', 'ok', 'okay', 'sure', 'thanks', 'thank you', 'fix it', 'do it', 'next', 'proceed', 'please continue', 'one', 'two word prompt', 'make this async']) {
    assert.equal(isContinuation(p), true, `${p}: still a continuation`);
  }
  assert.equal(isContinuation('fix the login bug'), false, 'four words is not under four');
  const sb = sandbox();
  let routes, close;
  try {
    ({ routes, close } = await standIn(sb));
    for (const p of ['continue', 'make this async']) {
      routes.length = 0;
      const r = await hook(sb, p);
      assert.equal(r.code, 0, `${p}: the hook exits 0`);
      assert.ok(routes.includes('/v1/journal'), `${p}: the prompt is still recorded`);
      assert.equal(routes.includes('/v1/recall'), false, `${p}: no recall call (${routes})`);
    }
  } finally {
    await close?.(); sb.stop();
  }
});
