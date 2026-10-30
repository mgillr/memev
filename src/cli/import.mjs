// SPDX-License-Identifier: Apache-2.0
// memev import: preview and import history from project folders, AI history files, and chat export zips.
import { resolveRoot, config, saveConfig, PKG, daemonInfo, pidAlive } from './common.mjs';
import { isVault, Vault } from '../engine/vault.mjs';
import { stopDaemon, startDaemon } from './daemon.mjs';
import { scanAll, existingHashes, dedup, runImport, listImports, undoImport, offerImport } from '../engine/importers/core.mjs';

export { offerImport };

// Is this vault's daemon process running? I ask the process table, not the daemon, so the answer is
// the same with every network path dead: a health check over the wire would read "down" and leave a
// live daemon holding the vault open under me, with a stale in-memory index.
const daemonUp = (root) => { const i = daemonInfo(root); return !!(i && pidAlive(i.pid)); };

function buildPreview(items) {
  const lines = ['Import preview', ''];
  let n = 0;
  const bySource = {};
  for (const it of items) { (bySource[it.source] ||= []).push(it); }
  for (const [src, list] of Object.entries(bySource)) {
    lines.push(`${src}:`);
    for (const it of list) {
      if (it.skip) lines.push(`  skipped: ${it.title} (${it.reason})`);
      else { n++; lines.push(`  ${n}. ${it.title} (${Math.ceil(it.size / 1024)} KB)`); }
    }
    const totalKb = Math.ceil(list.reduce((s, it) => s + (it.size || 0), 0) / 1024);
    lines.push(`  ${list.length} item(s), ${totalKb} KB`);
    lines.push('');
  }
  lines.push(`${n} item(s) to import, ${items.length - n} skipped`);
  return lines.join('\n');
}

export async function command(cmd, pos, flags, { root, env }) {
  if (!isVault(root)) throw new Error(`no vault at ${root}; run memev init`);
  const sub = pos[0];

  if (sub === 'list') {
    const wasUp = daemonUp(root);
    if (wasUp) await stopDaemon(root);
    const v = new Vault(root).open();
    try {
      const list = listImports(v);
      if (!list.length) { console.log('No imports yet.'); return 0; }
      for (const it of list) console.log(`${it.id}  ${it.items} item(s)  ${it.path}`);
    } finally { v.close(); }
    if (wasUp) { try { await startDaemon(root, { quiet: true }); } catch {} }
    return 0;
  }

  if (sub === 'undo') {
    const id = pos[1];
    if (!id) { console.log('Usage: memev import undo <import-id>'); return 1; }
    const wasUp = daemonUp(root);
    if (wasUp) await stopDaemon(root);
    const v = new Vault(root).open();
    try {
      const identity = { agent: 'cli', scopes: ['read', 'write'], paths: ['**'] };
      const r = undoImport(v, identity, id);
      if (!r.ok) { console.log(r.error); return 1; }
      console.log(`Removed ${id}.`);
    } finally { v.close(); }
    if (wasUp) { try { await startDaemon(root, { quiet: true }); } catch {} }
    return 0;
  }

  const paths = flags.path ? String(flags.path).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const aiHistory = !!flags['ai-history'];
  const exportFiles = flags.export ? String(flags.export).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const preview = !!flags.preview;
  const yes = !!flags.yes;
  const keep = flags.keep ? String(flags.keep) : null;

  if (!paths.length && !aiHistory && !exportFiles.length) {
    paths.push(process.cwd());
    aiHistory = true;
  }

  const items = scanAll({ paths, aiHistory, exports: exportFiles, cwd: process.cwd(), home: env.HOME || '' });
  const wasUp = daemonUp(root);
  if (wasUp) await stopDaemon(root);
  const v = new Vault(root).open();
  try {
    const hashes = existingHashes(v);
    const deduped = dedup(items, hashes);
    console.log(buildPreview(deduped));

    if (preview) { console.log('Preview only. Nothing imported.'); return 0; }

    let selected = null;
    if (yes) selected = deduped;
    else if (keep) {
      const nums = keep.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => n >= 1);
      const numbered = deduped.map((it, i) => ({ it, n: i + 1 }));
      selected = numbered.filter(({ n }) => nums.includes(n)).map(({ it }) => it);
    } else if (process.stdin.isTTY) {
      const { createInterface } = await import('node:readline');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const ans = await new Promise((r) => rl.question('Import these items? [Y/n] ', r));
      rl.close();
      const a = ans.trim().toLowerCase();
      if (a === '' || a === 'y' || a === 'yes') selected = deduped;
    } else {
      console.log('Nothing imported. Use --yes to import all, or --keep 1,2 to pick items.');
      return 0;
    }

    if (!selected || !selected.some((it) => !it.skip)) {
      console.log('Nothing to import.');
      return 0;
    }

    const identity = { agent: 'cli', scopes: ['read', 'write'], paths: ['**'] };
    const result = runImport(v, identity, selected);
    console.log(`Imported ${result.imported} item(s) as ${result.id} (${result.skipped} skipped).`);
    console.log(`Undo with: memev import undo ${result.id}`);
  } finally { v.close(); }
  if (wasUp) { try { await startDaemon(root, { quiet: true }); } catch {} }
  return 0;
}
