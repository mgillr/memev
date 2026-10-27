import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { PKG, tmpdir } from './tmp.mjs';

export const BIN = path.join(PKG, 'bin', 'memev.mjs');
let nextPort = 20000 + (process.pid % 20000);
export function sandbox() {
  const home = tmpdir('home-');
  const port = nextPort++ + Math.floor(Math.random() * 500);
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
