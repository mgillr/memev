// SPDX-License-Identifier: Apache-2.0
// `memev mcp`: an MCP server on stdio for clients that launch one. It forwards every message to the
// daemon so there is one writer, and starts the daemon if it is not running.
import readline from 'node:readline';
import { clientToken, daemonInfo, config } from './common.mjs';
import { ensureDaemon } from './daemon.mjs';
import { fetchOut } from '../engine/net.mjs';

export async function runStdio(root, client) {
  const write = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
  let ready = null; let token = null;
  const ready_ = () => (ready ||= ensureDaemon(root, { quiet: true }).then((ok) => { token = clientToken(root, client); return ok; }));
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const inflight = new Set();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg; try { msg = JSON.parse(line); } catch { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); return; }
    const p = (async () => {
      const ok = await ready_();
      if (!ok) { if (msg.id !== undefined) write({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'Memev daemon is not running and could not be started; run memev doctor' } }); return; }
      const port = daemonInfo(root)?.port || config(root).port;
      try {
        const r = await fetchOut(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-memev-client': client }, body: JSON.stringify(msg) });
        if (r.status === 202) return;
        const body = await r.text(); if (body) process.stdout.write(`${body.trim()}\n`);
      } catch (e) { if (msg.id !== undefined) write({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: `Memev: ${e.message}` } }); }
    })();
    inflight.add(p); p.finally(() => inflight.delete(p));
  });
  await new Promise((r) => rl.on('close', r));
  await Promise.all(inflight);
}
