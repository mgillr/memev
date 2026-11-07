// SPDX-License-Identifier: Apache-2.0
// `memev mcp`: an MCP server on stdio for clients that launch one. It forwards every message to the
// daemon so there is one writer, and starts the daemon if it is not running.
import readline from 'node:readline';
import { clientToken, daemonInfo, config, effectiveClient } from './common.mjs';
import { ensureDaemon } from './daemon.mjs';
import { fetchOut } from '../engine/net.mjs';
import path from 'node:path';
import { ancestors, procTable, readLink } from './session-link.mjs';

/** The headers that tell the vault which app session this MCP server serves, read again on each call (a /clear moves it). */
export function busSessionHeaders(dir, client, chain) {
  const r = readLink(dir, chain(), client);
  return r ? { 'x-memev-bus-session': String(r.session).slice(0, 96) } : {};
}
/** This process's parents, read once: they do not change while it runs. */
export function chainOnce(pid = process.pid) { let c = null; return () => (c ??= ancestors(pid, procTable())); }

export async function runStdio(root, client) {
  const who = effectiveClient(client);
  const write = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
  let ready = null; let token = null;
  const ready_ = () => (ready ||= ensureDaemon(root, { quiet: true }).then((ok) => { token = clientToken(root, who); return ok; }));
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const inflight = new Set();
  const chain = chainOnce(); const linkDir = path.join(root, '.memev', 'hooks');
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg; try { msg = JSON.parse(line); } catch { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); return; }
    const p = (async () => {
      const ok = await ready_();
      if (!ok) { if (msg.id !== undefined) write({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'Memev daemon is not running and could not be started; run memev doctor' } }); return; }
      const port = daemonInfo(root)?.port || config(root).port;
      try {
        const r = await fetchOut(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-memev-client': who, ...(msg.method === 'tools/call' ? busSessionHeaders(linkDir, client, chain) : {}) }, body: JSON.stringify(msg) });
        if (r.status === 202) return;
        const body = await r.text(); if (body) process.stdout.write(`${body.trim()}\n`);
      } catch (e) { if (msg.id !== undefined) write({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: `Memev: ${e.message}` } }); }
    })();
    inflight.add(p); p.finally(() => inflight.delete(p));
  });
  await new Promise((r) => rl.on('close', r));
  await Promise.all(inflight);
}
