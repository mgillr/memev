// SPDX-License-Identifier: Apache-2.0
// Find AI history files already on the machine: Claude Code and Cursor memory files,
// CLAUDE.md and similar rule files. Read-only, never edited or removed.
import fs from 'node:fs';
import path from 'node:path';
import { findSecrets } from '../secrets.mjs';

const MAX_SIZE = 512 * 1024;

function tryRead(file, source, sourceTag) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size === 0 || st.size > MAX_SIZE) return null;
    const content = fs.readFileSync(file, 'utf8');
    if (findSecrets(content).length) return { title: path.basename(file), source, sourcePath: file, content: null, size: null, skip: true, reason: 'secret' };
    return { title: path.basename(file), source, sourcePath: file, content, size: Buffer.byteLength(content), skip: false, reason: null };
  } catch { return null; }
}

function scanDir(dir, source, sourceTag) {
  const items = [];
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return items; }
  for (const e of ents) {
    if (!e.isFile()) continue;
    if (!e.name.endsWith('.md') && !e.name.endsWith('.txt')) continue;
    const item = tryRead(path.join(dir, e.name), source, sourceTag);
    if (item) items.push(item);
  }
  return items;
}

export function scanAiHistory({ cwd = process.cwd(), home = process.env.HOME || '' }) {
  const items = [];
  const seen = new Set();
  const add = (item) => {
    if (!item) return;
    const key = path.resolve(item.sourcePath);
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };

  // Project-level rule files
  for (const name of ['CLAUDE.md', 'AGENTS.md', 'CLAUDE.local.md']) {
    add(tryRead(path.join(cwd, name), 'ai-history', 'project'));
  }

  // Claude Code: global and project memory
  const claudeDir = path.join(home, '.claude');
  add(tryRead(path.join(claudeDir, 'CLAUDE.md'), 'ai-history', 'claude-code'));
  add(tryRead(path.join(claudeDir, 'memory.md'), 'ai-history', 'claude-code'));
  const projectsDir = path.join(claudeDir, 'projects');
  if (fs.existsSync(projectsDir)) {
    let ents;
    try { ents = fs.readdirSync(projectsDir, { withFileTypes: true }); } catch { ents = []; }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      add(tryRead(path.join(projectsDir, e.name, 'memory.md'), 'ai-history', 'claude-code'));
      add(tryRead(path.join(projectsDir, e.name, 'CLAUDE.md'), 'ai-history', 'claude-code'));
    }
  }

  // Cursor: global and project rules
  const cursorDir = path.join(home, '.cursor');
  add(tryRead(path.join(cursorDir, 'rules.md'), 'ai-history', 'cursor'));
  const cursorRules = path.join(cursorDir, 'rules');
  for (const item of scanDir(cursorRules, 'ai-history', 'cursor')) add(item);
  const projCursorRules = path.join(cwd, '.cursor', 'rules');
  for (const item of scanDir(projCursorRules, 'ai-history', 'cursor')) add(item);

  // Shared rule files in home
  add(tryRead(path.join(home, 'AGENTS.md'), 'ai-history', 'home'));
  add(tryRead(path.join(home, 'CLAUDE.md'), 'ai-history', 'home'));

  return items;
}
