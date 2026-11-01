// SPDX-License-Identifier: Apache-2.0
// `memev contract …`, `memev verify`, `memev gate`: the same operations the MCP tools offer, from a
// terminal. Verification always runs on this machine; nothing here needs or installs a CI service.
import fs from 'node:fs';
import path from 'node:path';

import { healthy, startDaemon } from './daemon.mjs';
import http from 'node:http';
import { api, clientToken, config, daemonInfo, saveConfig, adminToken } from './common.mjs';
import { FOOTER, footerEnabled } from '../engine/card.mjs';

export const GATE_HOOK = (launcher, wd) => `#!/bin/sh
# memev: refuse to push while a signed contract for this directory does not verify (runs locally).
exec "${launcher}" gate --workdir "${wd}"
`;

/**
 * The spec `memev contract new` drafts. Its workdir is --workdir when given, else the spec's own; a spec with neither is refused,
 * so commands, the base and scope never fall back to the vault root by accident, and the workdir is recorded as its absolute real
 * path. --base, or the spec's base, is an explicit base revision: a commit sha of 40 hex characters and nothing else.
 */
export function newContractSpec(spec, flags = {}) {
  const s = { ...spec };
  if (flags.workdir !== undefined && flags.workdir !== true) s.workdir = String(flags.workdir);
  if (!s.workdir) throw new Error('the spec names no workdir: pass --workdir <dir>, the checkout the criteria run in');
  try { s.workdir = fs.realpathSync(path.resolve(String(s.workdir))); } catch { throw new Error(`the workdir ${s.workdir} does not exist`); }
  if (flags.base !== undefined) s.base = flags.base === true ? '' : String(flags.base);
  if (s.base !== undefined && s.base !== null && !(typeof s.base === 'string' && /^[0-9a-fA-F]{40}$/.test(s.base))) throw new Error('the base must be a commit sha of 40 hex characters');
  return s;
}

async function reloadDaemon(root) { const t = adminToken(root); if (!t) return false; try { return (await api(root, '/v1/reload', { token: t })).ok; } catch { return false; } }

// A verify runs every criterion command (red-green runs twice) and can take longer than the 600 s the other calls wait. It
// goes over node:http, which sets no limit on the wait for the answer (fetch gives up on a silent connection after 300 s), and
// stays open until the daemon answers.
function waitingCall(root, token, body) {
  const port = daemonInfo(root)?.port || config(root).port;
  const text = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', agent: false, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), authorization: `Bearer ${token}` } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const t = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(t); } catch { /* not JSON */ } resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json, text: t }); });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(text);
  });
}
const mcpCall = (root, name, args) => {
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } };
  return name === 'memev_contract_verify' ? waitingCall(root, clientToken(root, 'cli'), body) : api(root, '/mcp', { token: clientToken(root, 'cli'), body, timeoutMs: 600000 });
};

export async function command(cmd, pos, flags, { root, env }) {
  const sub = cmd === 'verify' ? 'verify-cmd' : cmd === 'gate' ? 'gate' : pos[0] || 'list';
  const data = async (name, args) => {
    const r = await mcpCall(root, name, args);
    const res = r.json?.result; if (!res) throw new Error(r.text); if (res.isError) throw new Error(res.content[0].text);
    return res.structuredContent;
  };
  const call = async (name, args) => {
    const r = await mcpCall(root, name, args);
    const res = r.json?.result; if (!res) throw new Error(r.text);
    console.log(res.content[0].text); return res.isError ? 1 : (res.structuredContent?.ok === false ? 1 : 0);
  };
  // approve is an admin action; the CLI's client token is read+write, so it goes over the admin token
  const callAdmin = async (name, args) => {
    const t = adminToken(root); if (!t) throw new Error('no admin token found; run memev init');
    const r = await api(root, '/mcp', { token: t, body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, timeoutMs: 600000 });
    const res = r.json?.result; if (!res) throw new Error(r.text);
    console.log(res.content[0].text); return res.isError ? 1 : (res.structuredContent?.ok === false ? 1 : 0);
  };
  if (cmd === 'contracts') {
    if (sub === 'on' || sub === 'off') {
      const cfg = config(root);
      cfg.contracts = { ...cfg.contracts, enabled: sub === 'on' };
      saveConfig(root, cfg);
      const live = await reloadDaemon(root);
      console.log(sub === 'on' ? 'Contracts are on. Build requests get a contract nudge, and the Stop hook blocks while a signed contract is not verified. Turn them off with: memev contracts off' : 'Contracts are off. Build requests get no nudge, and the Stop hook never blocks on a contract. Turn them back on with: memev contracts on');
      if (!live) console.log('  ! the daemon is not running; the change applies when it starts');
      return 0;
    }
    if (sub === 'status') {
      const on = config(root).contracts?.enabled !== false;
      console.log(`Contracts: ${on ? 'on' : 'off'}`);
      return 0;
    }
    throw new Error('memev contracts on | off | status');
  }
  if (!(await healthy(root))) await startDaemon(root, { quiet: true });
  if (sub === 'list') return call('memev_contract_list', {});
  if (sub === 'status') { const code = await call('memev_contract_status', { id: pos[1], project: flags.project, all: !!flags.all }); if (code === 0 && footerEnabled(root)) console.log(`\n${FOOTER}`); return code; }
  if (sub === 'from-request') return call('memev_contract_from_request', { request: pos.slice(1).join(' '), project: flags.project, workdir: flags.workdir ? path.resolve(String(flags.workdir)) : process.cwd() });
  if (sub === 'verify-cmd' || sub === 'gate') {
    // memev verify [id]: verify one contract, or every open one. memev gate: the same, as an exit code,
    // limited to contracts whose workdir is --workdir (default: here). Used by the optional git hook.
    const wd = flags.workdir ? path.resolve(String(flags.workdir)) : sub === 'gate' ? process.cwd() : null;
    const id = sub === 'verify-cmd' ? pos[0] : null;
    const open = id ? [{ id }] : ((await data('memev_contract_status', {}))?.contracts || []).filter((c) => !wd || (c.workdir && path.resolve(c.workdir) === wd));
    if (!open.length) { console.log(sub === 'gate' ? 'memev gate: no open contract for this directory' : 'No open contracts.'); return 0; }
    let bad = 0;
    for (const c of open) {
      const r = await data('memev_contract_verify', { id: c.id });
      console.log(`${r.verdict || (r.ok ? 'PASS' : 'FAIL')} ${c.id}: ${r.passed ?? 0}/${r.total ?? 0} tasks${r.behaviour && r.documents ? `, behaviour ${r.behaviour.passed}/${r.behaviour.total}, documents ${r.documents.passed}/${r.documents.total}` : ''}${r.signature && r.signature !== 'ok' && !r.ok && !r.tasks?.length ? ` (${r.signature})` : ''}`);
      for (const t of r.remaining || []) console.log(`  ${t.status} ${t.id} ${t.title}${t.failing?.length ? `: ${t.failing[0]}` : ''}`);
      if (!r.ok) bad++;
    }
    return bad ? 1 : 0;
  }
  if (sub === 'hook') {
    // optional: a local pre-push hook in the project's own repository. Never a CI workflow.
    const wd = path.resolve(String(pos[1] || flags.workdir || process.cwd()));
    const hooks = path.join(wd, '.git', 'hooks'); if (!fs.existsSync(path.join(wd, '.git'))) throw new Error(`${wd} is not a git repository`);
    const f = path.join(hooks, 'pre-push');
    if (fs.existsSync(f) && !fs.readFileSync(f, 'utf8').includes('memev: refuse to push')) throw new Error(`${f} already exists; add "memev gate --workdir ${wd}" to it yourself`);
    const { launcherPath } = await import('./clients.mjs');
    fs.mkdirSync(hooks, { recursive: true }); fs.writeFileSync(f, GATE_HOOK(launcherPath(env), wd), { mode: 0o755 });
    console.log(`Installed ${f}: pushes from ${wd} wait for its open contracts to verify. Remove the file to undo.`);
    return 0;
  }
  if (sub === 'new') return call('memev_contract_draft', newContractSpec(JSON.parse(fs.readFileSync(pos[1], 'utf8')), flags));
  if (sub === 'sign') return call('memev_contract_sign', { id: pos[1] });
  if (sub === 'approve') return callAdmin('memev_contract_approve', { id: pos[1] });
  if (sub === 'verify') return call('memev_contract_verify', { id: pos[1] });
  if (sub === 'amend') return call('memev_contract_amend', { id: pos[1], title: flags.title });
  if (sub === 'decompose') return call('memev_contract_decompose', { scope: JSON.parse(fs.readFileSync(pos[1], 'utf8')) });
  throw new Error('memev contract list | status [id] | from-request <text> | new <spec.json> [--workdir <dir>] [--base <sha>] | sign <id> | approve <id> | verify <id> | amend <id> | decompose <scope.json> | hook [dir]');
}

