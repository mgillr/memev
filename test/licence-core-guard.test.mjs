// SPDX-License-Identifier: Apache-2.0
// The licence boundary: crdt-merge is BSL 1.1 and lives in its own repository. The Apache-2.0 core reaches it only through
// the provider interface and client (src/engine/merge.mjs, docs/EXTENSION-POINTS.md). This test fails when crdt-merge
// implementation code, a vendored converge directory, or a crdt-merge package import appears in the shipped core.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PKG } from './helpers/tmp.mjs';

// The directories and manifests that ship in the package (package.json "files") plus the build files around it.
const SHIPPED_DIRS = ['bin', 'src', 'vendor', 'templates', 'scripts'];
const SHIPPED_FILES = ['package.json', 'Dockerfile', 'compose.yaml', 'compose.trial.yaml'];
const CODE = /\.(mjs|cjs|js|ts|tsx|jsx|py|rs|java|go|json|toml|yaml|yml|txt|cfg|lock|sh|ps1)$/i;
// Dependency or lock manifests: a crdt-merge entry here is a package import.
const MANIFEST = /(^|\/)(package(-lock)?\.json|requirements[^/]*\.txt|pyproject\.toml|Cargo\.(toml|lock)|pom\.xml|build\.gradle|go\.mod|yarn\.lock|pnpm-lock\.yaml)$/i;
// A package named crdt-merge in any ecosystem spelling, imported or required.
const PKG_IMPORT = /(?:from|import|require\s*\(|import\s*\()\s*['"`]?\s*(?:@[\w.-]+\/)?crdt[-_]merge(?:[-_]ts|[-_]rs|[-_]java)?(?:[/'"`)\s;]|$)|(?:from|import)\s+crdt_merge\b|\buse\s+crdt_merge\b|\bextern\s+crate\s+crdt_merge\b|\bnpm:crdt-merge|\bpip install\s+crdt-merge/im;
// The CRDT types and strategies the engine implements. The core may not define any of them.
const IMPL_NAMES = ['ORSet', 'LWWMap', 'LWWRegister', 'GCounter', 'PNCounter', 'ContextMerge', 'TrustAgentState', 'AgentState', 'CRDTState', 'MergeStrategy', 'GossipState', 'VectorClock'];
const IMPL_DEF = new RegExp(`(?:\\bclass\\s+(?:${IMPL_NAMES.join('|')})\\b|\\bfunction\\s+(?:${IMPL_NAMES.join('|')})\\b|\\bstruct\\s+(?:${IMPL_NAMES.join('|')})\\b|\\b(?:const|let|var)\\s+(?:${IMPL_NAMES.join('|')})\\s*=|\\bexport\\s+(?:default\\s+)?(?:class|function)\\s+(?:${IMPL_NAMES.join('|')})\\b)`);
// A licence header of the engine: a BSL file or the engine's own copyright line inside the Apache core.
const BSL_HEADER = /Business Source License|BUSL-1\.1|SPDX-License-Identifier:\s*BUSL/i;
// A path that is a copy of the engine.
const FORBIDDEN_PATH = /(^|\/)(vendor\/(converge|crdt[-_]merge[^/]*)|crdt[-_]merge[^/]*|converge)(\/|$)/i;

const walk = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
};

/** Every way the Apache core could hold the engine. Returns a list of findings, empty when the boundary holds. */
export function scanCore(root) {
  const found = [];
  const rel = (p) => path.relative(root, p).split(path.sep).join('/');
  const files = [...SHIPPED_DIRS.flatMap((d) => walk(path.join(root, d))), ...SHIPPED_FILES.map((f) => path.join(root, f)).filter((f) => fs.existsSync(f))];
  // a directory whose name is the engine, wherever it sits under a shipped directory
  const dirs = new Set();
  for (const f of files) { const parts = rel(f).split('/'); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/')); }
  for (const d of dirs) if (FORBIDDEN_PATH.test(`${d}/`)) found.push(`${d}/: a crdt-merge or converge directory in the Apache core`);
  for (const f of files) {
    const r = rel(f);
    if (FORBIDDEN_PATH.test(r) && !dirs.has(r)) found.push(`${r}: a file named for crdt-merge or converge in the Apache core`);
    if (!CODE.test(f) && !MANIFEST.test(r)) continue;
    let text; try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    if (PKG_IMPORT.test(text)) found.push(`${r}: imports a crdt-merge package`);
    if (MANIFEST.test(r) && /["']?crdt[-_]merge(?:[-_](?:ts|rs|java))?["']?\s*[:=<>~^]|crdt[-_]merge(?:[-_](?:ts|rs|java))?\s*(?:==|>=|<=|~=)/i.test(text)) found.push(`${r}: lists crdt-merge as a dependency`);
    if (IMPL_DEF.test(text)) found.push(`${r}: defines a CRDT type the engine implements`);
    if (BSL_HEADER.test(text)) found.push(`${r}: carries a Business Source License header`);
  }
  return found;
}

test('the Apache core holds no crdt-merge implementation, no vendor/converge directory and no crdt-merge package import', () => {
  assert.deepEqual(scanCore(PKG), []);
});

test('the one place the core reaches the engine is the provider boundary: src/engine/merge.mjs calls it as an external process', () => {
  const src = fs.readFileSync(path.join(PKG, 'src', 'engine', 'merge.mjs'), 'utf8');
  assert.match(src, /external|spawn|execFile|register/i, 'merge.mjs is the registration and call-out boundary');
  assert.doesNotMatch(src, /^\s*import\s[^;]*crdt/im);
  assert.ok(!fs.existsSync(path.join(PKG, 'vendor', 'converge')), 'no vendor/converge');
  assert.ok(!fs.existsSync(path.join(PKG, 'vendor', 'crdt-merge')), 'no vendor/crdt-merge');
});

test('the guard fails on each way the engine could be copied in (checked on a scratch tree, not the repository)', () => {
  const mk = (files) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-licence-'));
    for (const [rel, body] of Object.entries(files)) { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); }
    return root;
  };
  const cases = {
    'a vendor/converge directory': { 'vendor/converge/index.mjs': 'export const x = 1;\n' },
    'a vendor/crdt-merge directory': { 'vendor/crdt-merge-ts/index.mjs': 'export const x = 1;\n' },
    'a static crdt-merge import': { 'src/engine/x.mjs': "import { ORSetLike } from 'crdt-merge';\n" },
    'a scoped crdt-merge-ts import': { 'src/engine/x.mjs': "import { merge } from '@acme/crdt-merge-ts';\n" },
    'a dynamic crdt-merge import': { 'src/engine/x.mjs': "const m = await import('crdt-merge');\n" },
    'a require of crdt-merge': { 'src/engine/x.cjs': "const m = require('crdt-merge');\n" },
    'a python import': { 'src/engine/x.py': 'import crdt_merge\n' },
    'a package.json dependency': { 'package.json': '{ "dependencies": { "crdt-merge": "^1.0.0" } }\n' },
    'an ORSet implementation': { 'src/engine/or.mjs': 'export class ORSet { add() {} remove() {} merge() {} }\n' },
    'an LWWMap implementation': { 'src/engine/m.mjs': 'export function LWWMap() {}\n' },
    'a BSL licence header': { 'src/engine/b.mjs': '// Licensed under the Business Source License 1.1\n' },
  };
  for (const [name, files] of Object.entries(cases)) {
    const root = mk(files);
    try { assert.ok(scanCore(root).length > 0, `the guard misses ${name}`); } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
  const clean = mk({ 'src/engine/merge.mjs': "// the provider interface: the engine registers itself and is called as an external process\nexport const register = () => {};\n", 'package.json': '{ "name": "memev" }\n' });
  try { assert.deepEqual(scanCore(clean), []); } finally { fs.rmSync(clean, { recursive: true, force: true }); }
});
