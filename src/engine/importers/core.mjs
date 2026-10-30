// SPDX-License-Identifier: Apache-2.0
// Import orchestration: scan sources, filter secrets, write notes, dedup, list, undo.
import crypto from 'node:crypto';
import path from 'node:path';
import { sha256 } from '../util.mjs';
import { scanProject } from './project.mjs';
import { scanAiHistory } from './ai-history.mjs';
import { scanExport } from './exports.mjs';

const IMPORTS_DIR = 'memory/imports';

export function scanAll({ paths = [], aiHistory = false, exports = [], cwd = process.cwd(), home = process.env.HOME || '' }) {
  const items = [];
  const seen = new Set();
  const add = (list) => {
    for (const it of list) {
      const key = path.resolve(it.sourcePath);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(it);
    }
  };
  for (const p of paths) add(scanProject(p));
  if (aiHistory) add(scanAiHistory({ cwd, home }));
  for (const f of exports) add(scanExport(f));
  return items;
}

const IMPORT_ID = { agent: 'cli', scopes: ['read', 'write'], paths: ['**'] };

export function existingHashes(vault) {
  const hashes = new Set();
  for (const rel of vault.allNotes()) {
    if (!rel.startsWith(IMPORTS_DIR + '/')) continue;
    try {
      const note = vault.get(IMPORT_ID, rel);
      for (const m of note.body.matchAll(/^Hash: (sha256:[0-9a-f]{16})$/gm)) hashes.add(m[1]);
    } catch {}
  }
  return hashes;
}

function itemHash(item) {
  return 'sha256:' + sha256(item.sourcePath + '\0' + (item.content || '')).slice(0, 16);
}

export function dedup(items, hashes) {
  const kept = [];
  for (const it of items) {
    if (it.skip) { kept.push(it); continue; }
    const h = itemHash(it);
    if (hashes.has(h)) {
      kept.push({ ...it, skip: true, reason: 'already imported' });
    } else {
      it.hash = h;
      kept.push(it);
    }
  }
  return kept;
}

export function importId() {
  return 'imp-' + crypto.randomBytes(4).toString('hex');
}

export function buildNote(id, items) {
  const parts = [`# Import ${id}`, ''];
  for (const it of items) {
    if (it.skip) continue;
    parts.push(`### ${it.title}`, `Source: ${it.source}`, `Import: ${id}`, `Hash: ${it.hash}`, '', it.content, '');
  }
  return parts.join('\n');
}

export function runImport(vault, identity, items) {
  const id = importId();
  const selected = items.filter((it) => !it.skip);
  if (!selected.length) return { id, imported: 0, skipped: items.length, note: null };
  const body = buildNote(id, items);
  const rel = `${IMPORTS_DIR}/${id}.md`;
  vault.write(identity, { path: rel, body, client: 'import' });
  return { id, imported: selected.length, skipped: items.length - selected.length, note: rel };
}

export function listImports(vault) {
  const out = [];
  for (const rel of vault.allNotes()) {
    if (!rel.startsWith(IMPORTS_DIR + '/')) continue;
    try {
      const note = vault.get(IMPORT_ID, rel);
      const m = /^# Import (imp-[0-9a-f]{8})$/m.exec(note.body);
      if (!m) continue;
      const count = (note.body.match(/^### /gm) || []).length;
      out.push({ id: m[1], path: rel, items: count });
    } catch {}
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

export function undoImport(vault, identity, id) {
  if (!/^imp-[0-9a-f]{8}$/.test(id || '')) return { ok: false, error: 'not a valid import id' };
  const rel = `${IMPORTS_DIR}/${id}.md`;
  try {
    vault.get(IMPORT_ID, rel);
  } catch {
    return { ok: false, error: 'import not found' };
  }
  vault.delete(identity, { path: rel, client: 'import' });
  return { ok: true, id };
}

export async function offerImport({ root, env, flags = {}, ask = false, input, output, cwd = process.cwd(), home = env.HOME || '' }) {
  const { config, saveConfig } = await import('../../cli/common.mjs');
  const { startDaemon, stopDaemon, healthy } = await import('../../cli/daemon.mjs');
  const cfg = config(root);
  if (cfg.import && cfg.import.asked) return { asked: false, accepted: false, reason: 'already asked' };
  const paths = flags.path || [];
  let aiHistory = !!flags['ai-history'];
  const exportFiles = flags.export || [];
  if (!paths.length && !aiHistory && !exportFiles.length) {
    paths.push(cwd);
    aiHistory = true;
  }
  const items = scanAll({ paths, aiHistory, exports: exportFiles, cwd, home });
  const wasUp = await healthy(root);
  if (wasUp) await stopDaemon(root);
  const { Vault } = await import('../vault.mjs');
  const vault = new Vault(root);
  vault.open();
  try {
    const hashes = existingHashes(vault);
    const deduped = dedup(items, hashes);
    const preview = buildPreview(deduped);
    if (output) output.write(preview + '\n');
    let selected = null;
    if (flags.yes) {
      selected = deduped;
    } else if (flags.keep) {
      const nums = String(flags.keep).split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => n >= 1);
      const numbered = deduped.map((it, i) => ({ it, n: i + 1 }));
      selected = numbered.filter(({ n }) => nums.includes(n)).map(({ it }) => it);
    } else if (ask && input) {
      if (output) output.write('Import these items? [Y/n] ');
      let line = '';
      await new Promise((resolve) => {
        input.once('data', (d) => { line += d.toString(); if (line.includes('\n')) resolve(); });
        input.once('end', resolve);
      });
      const ans = line.trim().toLowerCase();
      if (ans === '' || ans === 'y' || ans === 'yes') selected = deduped;
    }
    let result = { id: null, imported: 0, skipped: deduped.length, note: null };
    if (selected && selected.some((it) => !it.skip)) {
      const identity = { agent: 'cli', scopes: ['read', 'write'], paths: ['**'] };
      result = runImport(vault, identity, selected);
    }
    const c2 = config(root);
    c2.import = { asked: true, accepted: !!(selected && selected.length) };
    saveConfig(root, c2);
    return { asked: true, accepted: !!(selected && selected.length), result, preview };
  } finally {
    vault.close();
    if (wasUp) await startDaemon(root, { quiet: true });
  }
}

function buildPreview(items) {
  const lines = ['Import preview', ''];
  let n = 0;
  const bySource = {};
  for (const it of items) {
    (bySource[it.source] ||= []).push(it);
  }
  for (const [src, list] of Object.entries(bySource)) {
    lines.push(`${src}:`);
    for (const it of list) {
      if (it.skip) {
        lines.push(`  skipped: ${it.title} (${it.reason})`);
      } else {
        n++;
        lines.push(`  ${n}. ${it.title} (${Math.ceil(it.size / 1024)} KB)`);
      }
    }
    const totalKb = Math.ceil(list.reduce((s, it) => s + (it.size || 0), 0) / 1024);
    lines.push(`  ${list.length} item(s), ${totalKb} KB`);
    lines.push('');
  }
  lines.push(`${n} item(s) to import, ${items.length - n} skipped`);
  return lines.join('\n');
}
