// SPDX-License-Identifier: Apache-2.0
// docs/MODULES.md is written by scripts/docs/module-graph.mjs from the real imports; it must match the code on this branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph, importsOf, page, purposeOf } from '../scripts/docs/module-graph.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('docs/MODULES.md matches the imports in bin/ and src/ (run node scripts/docs/module-graph.mjs to update it)', () => {
  assert.equal(fs.readFileSync(path.join(ROOT, 'docs', 'MODULES.md'), 'utf8'), page(buildGraph(ROOT)));
});

test('every module in bin/ and src/ is on the map, and every edge points at a module that exists', () => {
  const g = buildGraph(ROOT);
  const ids = new Set(g.nodes.map((n) => n.id));
  assert.ok(ids.has('bin/memev.mjs') && ids.has('src/cli/main.mjs') && ids.has('src/engine/vault.mjs'));
  for (const e of g.edges) { assert.ok(ids.has(e.from), e.from); assert.ok(ids.has(e.to) || e.to.startsWith('vendor/'), e.to); }
});

test('the import reader sees static, re-export, dynamic and table-loaded modules', () => {
  const src = `// import { nope } from './no.mjs';\nimport a from './a.mjs';\nimport { b } from "../b.mjs";\nexport { c } from './c.mjs';\nconst d = await import('./d.mjs');\nconst T = { x: './e.mjs' };\nimport fs from 'node:fs';\n`;
  assert.deepEqual(importsOf(src).map((i) => [i.spec, i.dynamic]), [['./a.mjs', false], ['../b.mjs', false], ['./c.mjs', false], ['./d.mjs', true], ['./e.mjs', true]]);
  assert.equal(purposeOf('// SPDX-License-Identifier: Apache-2.0\n// The vault: Markdown notes. More text.\n'), 'The vault: Markdown notes');
});
