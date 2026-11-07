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

test('every spawn, spawnSync, execFile, execFileSync and execSync call in src/ passes windowsHide: true', () => {
  const missing = [];
  for (const f of walk(path.join(ROOT, 'src'))) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/\b(spawn|spawnSync|execFileSync|execFile|execSync)\(/g)) {
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
