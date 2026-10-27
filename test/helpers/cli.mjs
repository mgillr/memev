import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { PKG, tmpdir } from './tmp.mjs';

export const BIN = path.join(PKG, 'bin', 'memev.mjs');
// A daemon port for each sandbox. The system hands out a port nothing is listening on, and a file per port
// under a folder for this test run reserves it, so two test files running at once never get the same port.
// node --test runs each file in a child of one runner, so the runner's pid names the run.
const RESERVED = path.join(os.tmpdir(), `memev-test-ports-${process.ppid}`);
const FREE_PORT = "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})";
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
let swept = false;
export function freePort() {
  if (!swept) { // the folders of runs that have finished
    swept = true;
    for (const d of fs.readdirSync(os.tmpdir())) {
      const m = /^memev-test-ports-(\d+)$/.exec(d);
      if (m && !alive(Number(m[1]))) fs.rmSync(path.join(os.tmpdir(), d), { recursive: true, force: true });
    }
  }
  fs.mkdirSync(RESERVED, { recursive: true });
  for (let tries = 0; tries < 50; tries++) {
    const port = Number(spawnSync(process.execPath, ['-e', FREE_PORT], { encoding: 'utf8' }).stdout);
    if (!Number.isInteger(port) || port <= 0) continue;
    try { fs.writeFileSync(path.join(RESERVED, String(port)), String(process.pid), { flag: 'wx' }); return port; } catch {}
  }
  throw new Error('no free port for the test daemon');
}
export function sandbox() {
  const home = tmpdir('home-');
  const port = freePort();
  const env = { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), MEMEV_CONFIG_DIR: path.join(home, '.config', 'memev'), MEMEV_ROOT: path.join(home, 'memev'), MEMEV_NO_SERVICE: '1', MEMEV_NO_TUNNEL: '1', MEMEV_NO_BACKGROUND: '1', MEMEV_NO_DOWNLOAD: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };
  const run = (args, { input = '', extraEnv = {} } = {}) => { const r = spawnSync(process.execPath, [BIN, ...args], { env: { ...env, ...extraEnv }, input, encoding: 'utf8', timeout: 30000 }); return { code: r.status, out: r.stdout, err: r.stderr }; };
  const hook = (event, payload, client = 'claude-code', extra = []) => run(['hook', event, '--client', client, ...extra], { input: JSON.stringify(payload) });
  const stop = () => run(['stop']);
  return { home, env, port, run, hook, stop, root: env.MEMEV_ROOT };
}
export function mcpClient(sb, client) {
  const p = spawn(process.execPath, [BIN, 'mcp', '--client', client], { env: sb.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const waiting = new Map(); let id = 0;
  p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; const m = JSON.parse(line); waiting.get(m.id)?.(m); waiting.delete(m.id); } });
  const request = (method, params) => new Promise((resolve) => { const n = ++id; waiting.set(n, resolve); p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`); });
  const tool = async (name, args) => { const r = await request('tools/call', { name, arguments: args }); if (r.error) throw new Error(r.error.message); return r.result; };
  const close = () => new Promise((r) => { p.on('close', r); p.stdin.end(); });
  return { request, tool, close };
}
export function transcript(file, entries) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}
export const user = (text) => ({ type: 'user', message: { role: 'user', content: text } });
export const assistant = (text, tools = []) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }, ...tools.map(([name, input], i) => ({ type: 'tool_use', id: `t${i}`, name, input }))] } });
export const todos = (list) => ['TodoWrite', { todos: list.map(([status, content]) => ({ status, content, activeForm: content })) }];
