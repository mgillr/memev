// SPDX-License-Identifier: Apache-2.0
// Every child process the core starts is started hidden on Windows. The daemon runs with no console, so a child started
// without windowsHide opens a console window of its own: on a first install the owner saw terminals open and close in a row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.mjs') ? [path.join(d, e.name)] : []));

test('every child_process call in src/, under its own name or an alias, passes windowsHide: true', () => {
  const missing = [];
  for (const f of walk(path.join(ROOT, 'src'))) {
    const s = fs.readFileSync(f, 'utf8');
    // the names this file gives the child_process functions, aliases included (import { spawn as spawnChild })
    const names = new Set();
    for (const imp of s.matchAll(/import\s*\{([^}]*)\}\s*from\s*'node:child_process'/g)) {
      for (const part of imp[1].split(',')) { const [orig, alias] = part.trim().split(/\s+as\s+/); if (/^(spawn|spawnSync|execFileSync|execFile|execSync|exec|fork)$/.test(orig)) names.add((alias || orig).trim()); }
    }
    for (const n of ['spawn', 'spawnSync', 'execFileSync', 'execFile', 'execSync']) names.add(n);
    const callRe = new RegExp(`\\b(${[...names].join('|')})\\(`, 'g');
    for (const m of s.matchAll(callRe)) {
      const before = s.slice(Math.max(0, m.index - 30), m.index);
      if (/import\s*\{[^}]*$|function\s+$|\/\/[^\n]*$/.test(before)) continue; // an import list, a declaration or a comment
      // the call's own text, up to its closing parenthesis
      let depth = 0; let i = m.index + m[0].length - 1;
      for (; i < s.length; i++) { if (s[i] === '(') depth++; else if (s[i] === ')' && --depth === 0) break; }
      const call = s.slice(m.index, i + 1);
      if (!/windowsHide:\s*true/.test(call)) missing.push(`${path.relative(ROOT, f)}:${s.slice(0, m.index).split('\n').length}`);
    }
  }
  assert.deepEqual(missing, [], `started without windowsHide: ${missing.join(', ')}`);
});
