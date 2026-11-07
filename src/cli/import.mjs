// SPDX-License-Identifier: Apache-2.0
// memev import: preview and import history from project folders, AI history files, and chat export zips.
import { resolveRoot, config, saveConfig, PKG, daemonInfo, pidAlive } from './common.mjs';
import { isVault, Vault } from '../engine/vault.mjs';
import { stopDaemon, startDaemon } from './daemon.mjs';
import { scanAll, existingHashes, dedup, runImport, listImports, undoImport, offerImport, runFullImport, scanSources, sourceList, splitSelection } from '../engine/importers/core.mjs';
import { walkHistory, scanHistory, DEFAULT_MARK_MAX } from '../engine/importers/history.mjs';
import { scanExport } from '../engine/importers/exports.mjs';
import path from 'node:path';

export { offerImport };

// Is this vault's daemon process running? I ask the process table, not the daemon, so the answer is
// the same with every network path dead: a health check over the wire would read "down" and leave a
// live daemon holding the vault open under me, with a stale in-memory index.
const daemonUp = (root) => { const i = daemonInfo(root); return !!(i && pidAlive(i.pid)); };

// The import works on the vault with the daemon stopped, so it is the only writer, and starts the daemon again on every
// way out, a return or a throw alike, as it was before and with its own settings, as offerImport does: --preview, list,
// a refused undo or an answer of no must not leave every app without memory until memev start.
async function withDaemonStopped(root, fn) {
  const wasUp = daemonUp(root);
  if (wasUp) await stopDaemon(root);
  try { return await fn(); }
  finally { if (wasUp) { try { await startDaemon(root, { quiet: true }); } catch {} } }
}

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

const listOf = (v) => [].concat(v ?? []).filter((x) => x !== true && x !== undefined).flatMap((s) => String(s).split(',')).map((s) => s.trim()).filter(Boolean);
// an export: id holds a path, which may hold a comma, so --source values are split on commas only outside one
const sourceIds = (v) => [].concat(v ?? []).filter((x) => typeof x === 'string').flatMap((s) => (s.startsWith('export:') ? [s] : s.split(','))).map((s) => s.trim()).filter(Boolean);

function historyPreview(walk) {
  const lines = [];
  for (const s of walk.sources) {
    const skips = [['already', 'already imported'], ['secret', 'skipped, they look like they hold a secret'], ['too_large', 'skipped as too large'], ['empty', 'empty'], ['unreadable', 'unreadable']].filter(([k]) => s[k]).map(([k, w]) => `${s[k]} ${w}`);
    lines.push(`${s.id}:`, `  ${s.found} conversation(s) found, ${s.new} to import${skips.length ? `; ${skips.join(', ')}` : ''}`);
    const mine = walk.listed.filter((x) => x.source === s.id);
    for (const it of mine.slice(0, 10)) lines.push(it.reason ? `  skipped: ${it.title} (${it.reason})` : `  - ${it.date || 'undated'} ${it.title} (${Math.ceil(it.size / 1024)} KB${it.parts > 1 ? `, in ${it.parts} parts` : ''})`);
    if (s.new > 10) lines.push(`  ... and ${s.new - Math.min(10, mine.filter((x) => !x.reason).length)} more`);
    lines.push('');
  }
  return lines.join('\n');
}

export async function command(cmd, pos, flags, { root, env, stdin = process.stdin, stdout = process.stdout }) {
  const sub = pos[0];

  if (sub === 'scan') {
    // read-only: no vault, no daemon; the JSON is the list the app's setup shows as checkboxes
    const sources = await scanSources({ env, cwd: flags.path ? String(flags.path) : null, exports: listOf(flags.export), quick: !!flags.quick });
    if (flags.json) { stdout.write(JSON.stringify({ sources, mark_max: DEFAULT_MARK_MAX }, null, 2) + '\n'); return 0; }
    console.log(sourceList(sources));
    console.log('\nImport some with: memev import --source <id> [--source <id>] (ids: memev import scan --json)');
    return 0;
  }

  if (!isVault(root)) throw new Error(`no vault at ${root}; run memev init`);

  if (sub === 'list') {
    return withDaemonStopped(root, () => {
      const v = new Vault(root).open();
      try {
        const list = listImports(v);
        if (!list.length) { console.log('No imports yet.'); return 0; }
        for (const it of list) console.log(`${it.id}  ${it.items} item(s)${it.conversations ? `, ${it.conversations} of them conversations` : ''}  ${it.path}`);
        return 0;
      } finally { v.close(); }
    });
  }

  if (sub === 'undo') {
    const id = pos[1];
    if (!id) { console.log('Usage: memev import undo <import-id>'); return 1; }
    return withDaemonStopped(root, () => {
      const v = new Vault(root).open();
      try {
        const identity = { agent: 'cli', scopes: ['read', 'write'], paths: ['**'] };
        const r = undoImport(v, identity, id);
        if (!r.ok) { console.log(r.error); return 1; }
        console.log(`Removed ${id}${r.conversations ? ` and its ${r.conversations} conversation note(s)` : ''}.`);
        return 0;
      } finally { v.close(); }
    });
  }

  const paths = listOf(flags.path);
  let aiHistory = !!flags['ai-history'];
  const exportFiles = listOf(flags.export);
  const chosen = sourceIds(flags.source);
  const preview = !!flags.preview;
  const yes = !!flags.yes;
  const keep = flags.keep ? String(flags.keep) : null;
  const home = env.HOME || '';

  // the chosen sources: file sources (project:<dir>, ai-history) become items in the import's own record, and every
  // other source (an app's sessions, an export) is walked conversation by conversation
  const fromSources = splitSelection(chosen, { cwd: process.cwd(), home });
  const history = [...fromSources.history];
  // an export named with --export is read as conversations; one in no known format is read as before, as one item
  const legacyExports = [];
  for (const f of exportFiles) {
    const found = (await scanHistory({ env, exports: [f], findDownloads: false })).some((s) => s.kind === 'export' && s.count > 0);
    if (found) history.push(`export:${path.resolve(f)}`); else legacyExports.push(f);
  }
  if (!paths.length && !aiHistory && !exportFiles.length && !chosen.length) {
    paths.push(process.cwd());
    aiHistory = true;
  }

  const items = [...fromSources.items, ...((paths.length || aiHistory || legacyExports.length) ? scanAll({ paths, aiHistory, exports: legacyExports, cwd: process.cwd(), home }) : [])];
  return withDaemonStopped(root, async () => {
    const v = new Vault(root).open();
    try {
      const hashes = existingHashes(v);
      const deduped = dedup(items, hashes);
      const identity = { agent: 'cli', scopes: ['read', 'write'], paths: ['**'] };
      // --yes imports without a preview pass: the walk that imports is the only read of each source
      let walk = null;
      if (!yes || preview) {
        if (deduped.length || !history.length) console.log(buildPreview(deduped));
        if (history.length) {
          walk = await walkHistory(v, identity, history, { env });
          console.log(historyPreview(walk));
        }
      }
      if (preview) { console.log('Preview only. Nothing imported.'); return 0; }

      let selected = null;
      let takeHistory = history.length > 0;
      if (yes) selected = deduped;
      else if (keep) {
        const nums = keep.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => n >= 1);
        const numbered = deduped.map((it, i) => ({ it, n: i + 1 }));
        selected = numbered.filter(({ n }) => nums.includes(n)).map(({ it }) => it);
        takeHistory = false; // --keep picks numbered file items; history sources are picked with --source
      } else if (stdin.isTTY) {
        // the person asked for this import, so Enter imports; init's unasked offer defaults to no (core.mjs)
        const { createInterface } = await import('node:readline');
        const rl = createInterface({ input: stdin, output: stdout });
        const ans = await new Promise((r) => rl.question('Import these items? [Y/n] ', r));
        rl.close();
        const a = ans.trim().toLowerCase();
        if (a === '' || a === 'y' || a === 'yes') selected = deduped; else takeHistory = false;
      } else {
        console.log('Nothing imported. Use --yes to import all, or --keep 1,2 to pick items.');
        return 0;
      }

      const anyItems = selected && selected.some((it) => !it.skip);
      const anyHistory = takeHistory && (walk ? walk.counts.new > 0 : true);
      if (!anyItems && !anyHistory) {
        console.log('Nothing to import.');
        return 0;
      }

      const result = await runFullImport(v, identity, { items: selected || [], history: takeHistory ? history : [], env });
      if (!result.id) { console.log('Nothing to import.'); return 0; }
      const extra = [result.conversations ? `${result.conversations} conversation(s)${result.split ? `, ${result.split} of them long enough to be written in parts (${result.notes} notes)` : ''}` : null, result.secret ? `${result.secret} skipped as they look like they hold a secret` : null, result.too_large ? `${result.too_large} skipped as too large` : null, result.already ? `${result.already} already imported` : null].filter(Boolean);
      console.log(`Imported ${result.imported} item(s) as ${result.id} (${result.skipped} skipped${extra.length ? `; ${extra.join(', ')}` : ''}).`);
      console.log(`Undo with: memev import undo ${result.id}`);
      return 0;
    } finally { v.close(); }
  });
}
