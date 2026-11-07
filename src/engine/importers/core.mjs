// SPDX-License-Identifier: Apache-2.0
// Import orchestration: scan sources, filter secrets, write notes, dedup, list, undo.
import crypto from 'node:crypto';
import path from 'node:path';
import { sha256 } from '../util.mjs';
import { scanProject } from './project.mjs';
import { scanAiHistory } from './ai-history.mjs';
import { scanExport } from './exports.mjs';
import { walkHistory, scanHistory, DEFAULT_MARK_MAX } from './history.mjs';

const IMPORTS_DIR = 'memory/imports';
// an import's own record: memory/imports/<import id>.md. The conversations it brought in are notes of their own under
// memory/imports/history/, each named in the record by a Note: line, so undo removes exactly those.
const MANIFEST = /^memory\/imports\/imp-[0-9a-f]{8}\.md$/;

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
    if (!MANIFEST.test(rel)) continue;
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

export function runImport(vault, identity, items, { id = importId() } = {}) {
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
    if (!MANIFEST.test(rel)) continue;
    try {
      const note = vault.get(IMPORT_ID, rel);
      const m = /^# Import (imp-[0-9a-f]{8})$/m.exec(note.body);
      if (!m) continue;
      // an item is a heading followed by its Source, Import and Hash lines; a heading inside an item's own text is not one
      const count = (note.body.match(new RegExp(`^### .*\\nSource: .*\\nImport: ${m[1]}\\nHash: `, 'gm')) || []).length;
      // a long conversation is written in parts (<name>-part-2.md and on); it is still one conversation
      const conversations = (note.body.match(/^Note: memory\/imports\/history\/\S+\.md$/gm) || []).filter((l) => !/-part-\d+\.md$/.test(l)).length;
      out.push({ id: m[1], path: rel, items: count + conversations, conversations });
    } catch {}
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

export function undoImport(vault, identity, id) {
  if (!/^imp-[0-9a-f]{8}$/.test(id || '')) return { ok: false, error: 'not a valid import id' };
  const rel = `${IMPORTS_DIR}/${id}.md`;
  let body;
  try {
    body = vault.get(IMPORT_ID, rel).body;
  } catch {
    return { ok: false, error: 'import not found' };
  }
  // each conversation note the record names, and only one that says it came from this import
  let removed = 0;
  for (const m of body.matchAll(/^Note: (memory\/imports\/history\/\S+\.md)$/gm)) {
    try {
      const note = vault.get(IMPORT_ID, m[1]);
      if (!new RegExp(`^Import: ${id}$`, 'm').test(note.body)) continue;
      vault.delete(identity, { path: m[1], client: 'import' });
      removed++;
    } catch { /* already removed by hand */ }
  }
  vault.delete(identity, { path: rel, client: 'import' });
  return { ok: true, id, conversations: removed };
}

/**
 * One import: the file items (project folders, AI memory files) go into the record itself, and every new conversation
 * of the chosen history sources becomes its own note, named in the record as it is written. Returns the counts.
 */
export async function runFullImport(vault, identity, { items = [], history = [], env, maxItemBytes, maxNoteBytes } = {}) {
  const id = importId();
  const selected = items.filter((it) => !it.skip);
  const rel = `${IMPORTS_DIR}/${id}.md`;
  let wrote = false;
  if (selected.length) { runImport(vault, identity, items, { id }); wrote = true; }
  let walk = { counts: { imported: 0, notes: 0, split: 0, found: 0, secret: 0, too_large: 0, already: 0, empty: 0, unreadable: 0 }, sources: [] };
  if (history.length) {
    walk = await walkHistory(vault, identity, history, {
      env, importId: id, write: true, maxItemBytes, maxNoteBytes,
      onNote: (note) => {
        if (!wrote) { vault.write(identity, { path: rel, body: `# Import ${id}\n\n`, client: 'import' }); wrote = true; }
        vault.append(identity, { path: rel, text: `Note: ${note}`, client: 'import' });
      },
    });
  }
  const c = walk.counts;
  return {
    id: wrote ? id : null, note: wrote ? rel : null,
    imported: selected.length + c.imported, files: selected.length, conversations: c.imported, notes: c.notes, split: c.split,
    skipped: items.length - selected.length + c.secret + c.too_large + c.already + c.empty + c.unreadable,
    secret: items.filter((it) => it.skip && it.reason === 'secret').length + c.secret,
    too_large: c.too_large, already: c.already + items.filter((it) => it.skip && it.reason === 'already imported').length,
    history: walk.sources,
  };
}

/** What setup and the app can offer: the file sources and every history source, with counts, marked or not. */
export async function scanSources({ env, cwd = null, exports = [], findDownloads = true, quick = false, markMax = DEFAULT_MARK_MAX, maxItemBytes } = {}) {
  const home = env.HOME || env.USERPROFILE || '';
  const out = [];
  const fileSource = (id, app, list, where) => {
    const usable = list.filter((it) => !it.skip);
    if (!list.length) return;
    out.push({ id, app, kind: 'files', path: where, unit: 'files', count: usable.length, bytes: usable.reduce((s, it) => s + (it.size || 0), 0), first: null, last: null, secret: list.filter((it) => it.reason === 'secret').length });
  };
  if (cwd) fileSource(`project:${path.resolve(cwd)}`, 'This folder', scanProject(cwd), path.resolve(cwd));
  fileSource('ai-history', 'AI memory and rule files', scanAiHistory({ cwd: cwd || home, home }), home);
  out.push(...await scanHistory({ env, exports, findDownloads, quick, maxItemBytes }));
  for (const s of out) s.marked = s.count !== null && s.count > 0 && s.count <= markMax;
  return out;
}

/** The file items of the chosen file sources (project:<dir>, ai-history), and the history selection for the rest. */
export function splitSelection(ids, { cwd = process.cwd(), home = '' } = {}) {
  const paths = []; let aiHistory = false; const history = [];
  for (const id of ids) {
    if (id === 'ai-history') aiHistory = true;
    else if (id.startsWith('project:')) paths.push(id.slice('project:'.length));
    else history.push(id);
  }
  const items = paths.length || aiHistory ? scanAll({ paths, aiHistory, cwd, home }) : [];
  return { items, history };
}

export async function offerImport({ root, env, flags = {}, ask = false, input, output, cwd = process.cwd(), home = env.HOME || '' }) {
  const { config, saveConfig } = await import('../../cli/common.mjs');
  const cfg = config(root);
  if (cfg.import && cfg.import.asked) return { asked: false, accepted: false, reason: 'already asked' };
  // The question goes to the user only on a terminal. Init's own --yes or --keep never answer it: an import needs a
  // list the person saw, or an explicit memev import --yes. Off a terminal I do nothing at all: no scan, no daemon
  // stop or restart, no config write. init must not be disturbed, and a daemon restarted here would stamp a start time
  // after the client edits init makes.
  if (!(ask && input)) return { asked: false, accepted: false, reason: 'not offered' };
  const { startDaemon, stopDaemon, healthy } = await import('../../cli/daemon.mjs');
  // Every source found: this folder, the AI memory files, each app's stored sessions and any chat export in
  // ~/Downloads. The scan reads directory listings and sizes only (an export found in Downloads is listed by size), so
  // the list shows at once; nothing is read in full until the person says yes.
  const exportFiles = [].concat(flags.export || []).flatMap((s) => String(s).split(',')).map((s) => s.trim()).filter(Boolean);
  const sources = await scanSources({ env: { ...env, HOME: home }, cwd, exports: exportFiles, quick: true });
  if (output) output.write(sourceList(sources) + '\n');
  // Nobody asked for this import and it reads AI history, so Enter imports nothing. memev import's own question,
  // which the person did ask for, keeps [Y/n].
  if (output) output.write('Import these items? [y/N] ');
  const line = await new Promise((resolve) => {
    let buf = '';
    const done = () => { input.off('data', onData); input.off('end', done); resolve(buf); };
    const onData = (d) => { buf += d.toString(); if (buf.includes('\n')) done(); };
    if (input.readableEnded) return resolve('');
    input.on('data', onData);
    input.once('end', done);
    // init's first question closes its readline, which pauses stdin, and a data listener does not resume a paused
    // stream: without this nothing keeps node alive, and init exits here with the daemon stopped
    input.resume?.();
  });
  input.pause?.(); // a terminal left flowing would keep init from exiting
  const chosen = chooseSources(sources, line.split('\n')[0]);
  let result = { id: null, imported: 0, skipped: 0, note: null };
  if (chosen.length) {
    const wasUp = await healthy(root);
    if (wasUp) await stopDaemon(root);
    const { Vault } = await import('../vault.mjs');
    const vault = new Vault(root);
    vault.open();
    try {
      const { items, history } = splitSelection(chosen.map((s) => s.id), { cwd, home });
      const deduped = dedup(items, existingHashes(vault));
      const identity = { agent: 'cli', scopes: ['read', 'write'], paths: ['**'] };
      if (output) output.write('Importing; the sources are only read, never changed.\n');
      result = await runFullImport(vault, identity, { items: deduped, history, env: { ...env, HOME: home } });
    } finally {
      vault.close();
      if (wasUp) await startDaemon(root, { quiet: true });
    }
  }
  // We only get here when the question was actually put to the user, so the answer is kept and it never comes back.
  const c2 = config(root);
  c2.import = { asked: true, accepted: chosen.length > 0 };
  saveConfig(root, c2);
  return { asked: true, accepted: chosen.length > 0, result, sources, chosen: chosen.map((s) => s.id) };
}

const kb = (n) => (n >= 1024 * 1024 * 1024 ? `${(n / 1024 / 1024 / 1024).toFixed(1)} GB` : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

/** The numbered list setup shows: [x] for a source marked for import, [ ] for one over the limit or not counted. */
export function sourceList(sources, { markMax = DEFAULT_MARK_MAX } = {}) {
  const lines = ['History found on this computer. Memev only reads it, and nothing leaves the computer.', ''];
  if (!sources.length) lines.push('  (nothing found)');
  sources.forEach((s, i) => {
    const what = s.count === null ? `${kb(s.bytes)}, not counted yet` : `${s.count} ${s.unit}, ${kb(s.bytes)}`;
    const when = s.first && s.last ? `, ${s.first.slice(0, 10)} to ${s.last.slice(0, 10)}` : '';
    const where = s.kind === 'export' || s.kind === 'files' ? ` (${s.path})` : '';
    lines.push(`  ${i + 1}. [${s.marked ? 'x' : ' '}] ${s.app}${where}: ${what}${when}`);
  });
  const sum = (list) => ({ n: list.reduce((a, s) => a + (s.count || 0), 0), b: list.reduce((a, s) => a + (s.bytes || 0), 0) });
  const all = sum(sources), marked = sum(sources.filter((s) => s.marked));
  if (sources.length) lines.push('', `In all: ${all.n} items, ${kb(all.b)}. Marked: ${marked.n} items, ${kb(marked.b)}.`);
  lines.push('');
  lines.push(`[x] marks a source with ${markMax} items or fewer. Enter imports nothing; y imports the marked sources;`);
  lines.push('all imports every source; numbers such as 1,3 import those. memev import undo removes an import.');
  return lines.join('\n');
}

/** The sources an answer picks: y the marked ones, all every one, a list of numbers those, anything else none. */
export function chooseSources(sources, answer) {
  const a = String(answer || '').trim().toLowerCase();
  if (a === 'y' || a === 'yes') return sources.filter((s) => s.marked);
  if (a === 'a' || a === 'all') return sources.slice();
  if (/^\d+(\s*,\s*\d+)*$/.test(a)) {
    const nums = new Set(a.split(',').map((x) => parseInt(x, 10)));
    return sources.filter((_, i) => nums.has(i + 1));
  }
  return [];
}
