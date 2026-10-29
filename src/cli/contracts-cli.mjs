// SPDX-License-Identifier: Apache-2.0
// `memev contract …`, `memev verify`, `memev gate`: the same operations the MCP tools offer, from a
// terminal. Verification always runs on this machine; nothing here needs or installs a CI service.
import fs from 'node:fs';
import path from 'node:path';

import { healthy, startDaemon } from './daemon.mjs';
import { api, clientToken, config, saveConfig, adminToken } from './common.mjs';
import { FOOTER, footerEnabled } from '../engine/card.mjs';

export const GATE_HOOK = (launcher, wd) => `#!/bin/sh
# memev: refuse to push while a signed contract for this directory does not verify (runs locally).
exec "${launcher}" gate --workdir "${wd}"
`;

async function reloadDaemon(root) { const t = adminToken(root); if (!t) return false; try { return (await api(root, '/v1/reload', { token: t })).ok; } catch { return false; } }

export async function command(cmd, pos, flags, { root, env }) {
  const sub = cmd === 'verify' ? 'verify-cmd' : cmd === 'gate' ? 'gate' : pos[0] || 'list';
  const data = async (name, args) => {
    const r = await api(root, '/mcp', { token: clientToken(root, 'cli'), body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, timeoutMs: 600000 });
    const res = r.json?.result; if (!res) throw new Error(r.text); if (res.isError) throw new Error(res.content[0].text);
    return res.structuredContent;
  };
  const call = async (name, args) => {
    const r = await api(root, '/mcp', { token: clientToken(root, 'cli'), body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, timeoutMs: 600000 });
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
      console.log(`${r.verdict || (r.ok ? 'PASS' : 'FAIL')} ${c.id}: ${r.passed ?? 0}/${r.total ?? 0} tasks${r.signature && r.signature !== 'ok' && !r.ok && !r.tasks?.length ? ` (${r.signature})` : ''}`);
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
  if (sub === 'new') { const spec = JSON.parse(fs.readFileSync(pos[1], 'utf8')); return call('memev_contract_draft', spec); }
  if (sub === 'sign') return call('memev_contract_sign', { id: pos[1] });
  if (sub === 'approve') return call('memev_contract_approve', { id: pos[1] });
  if (sub === 'verify') return call('memev_contract_verify', { id: pos[1] });
  if (sub === 'amend') return call('memev_contract_amend', { id: pos[1], title: flags.title });
  if (sub === 'decompose') return call('memev_contract_decompose', { scope: JSON.parse(fs.readFileSync(pos[1], 'utf8')) });
  throw new Error('memev contract list | status [id] | from-request <text> | new <spec.json> | sign <id> | approve <id> | verify <id> | amend <id> | decompose <scope.json> | hook [dir]');
}

