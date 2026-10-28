#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// The module interdependency map: reads every import in bin/ and src/ (static, re-export and literal dynamic
// imports) and writes docs/MODULES.md with a Mermaid graph, a layer summary and a per-module table.
// Usage: node scripts/docs/module-graph.mjs            write docs/MODULES.md
//        node scripts/docs/module-graph.mjs --check    exit 1 when docs/MODULES.md is out of date
//        node scripts/docs/module-graph.mjs --json     print the graph as JSON
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'docs', 'MODULES.md');
const SCAN = ['bin', 'src'];
const VENDOR = ['vendor'];

const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.mjs') ? [path.join(dir, e.name)] : [])) : []);
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

/** Every relative import in a source text: { spec, dynamic }. */
export function importsOf(text) {
  const out = [];
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const m of code.matchAll(/(?:^|[;\n}])\s*(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]/g)) out.push({ spec: m[1], dynamic: false });
  for (const m of code.matchAll(/(?:^|[;\n])\s*import\s*['"]([^'"]+)['"]/g)) out.push({ spec: m[1], dynamic: false });
  for (const m of code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push({ spec: m[1], dynamic: true });
  // a module path kept in a table of command names and loaded later with import(table[name])
  for (const m of code.matchAll(/['"](\.{1,2}\/[\w./-]+\.mjs)['"]/g)) if (!out.some((o) => o.spec === m[1])) out.push({ spec: m[1], dynamic: true });
  return out.filter((i) => i.spec.startsWith('.'));
}

/** The first sentence of a file's header comment (after the licence line), or ''. */
export function purposeOf(text) {
  const lines = text.split('\n').filter((l) => !l.startsWith('#!'));
  const head = [];
  for (const l of lines) { if (!l.startsWith('//')) break; head.push(l.replace(/^\/\/\s?/, '')); }
  const body = head.filter((l) => !/^SPDX-License-Identifier/.test(l)).join(' ').replace(/\s+/g, ' ').trim();
  const s = /^(.+?\.)(\s|$)/.exec(body);
  let t = (s ? s[1] : body).replace(/[.:]$/, '').replace(/\|/g, '/');
  if (t.length > 150) t = `${t.slice(0, 150).replace(/\s+\S*$/, '')}...`;
  return t;
}

export function buildGraph(root = ROOT) {
  const files = [...SCAN.flatMap((d) => walk(path.join(root, d)))].sort();
  const known = new Set(files.map(rel));
  const nodes = files.map((f) => ({ id: rel(f), purpose: purposeOf(fs.readFileSync(f, 'utf8')) }));
  const edges = new Map();
  for (const f of files) {
    for (const { spec, dynamic } of importsOf(fs.readFileSync(f, 'utf8'))) {
      let t = rel(path.resolve(path.dirname(f), spec));
      if (!known.has(t) && !VENDOR.some((v) => t.startsWith(`${v}/`))) continue;
      if (VENDOR.some((v) => t.startsWith(`${v}/`))) t = t.split('/').slice(0, 2).join('/');
      if (t === rel(f)) continue;
      const k = `${rel(f)}>${t}`; const prev = edges.get(k);
      edges.set(k, { from: rel(f), to: t, dynamic: prev ? prev.dynamic && dynamic : dynamic });
    }
  }
  return { nodes, edges: [...edges.values()].sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to)) };
}

const layer = (id) => (id.startsWith('src/') ? id.split('/')[1] : id.split('/')[0]);
const nid = (id) => id.replace(/\.mjs$/, '').replace(/[^A-Za-z0-9]/g, '_');
const label = (id) => id.replace(/^(src|bin)\//, '').replace(/^vendor\//, 'vendor/');

export function render(graph) {
  const { nodes, edges } = graph;
  const vendorIds = [...new Set(edges.map((e) => e.to).filter((t) => t.startsWith('vendor/')))];
  const all = [...nodes.map((n) => n.id), ...vendorIds];
  const layers = [...new Set(all.map(layer))];
  const lines = ['```mermaid', 'flowchart LR'];
  for (const l of layers) {
    lines.push(`  subgraph ${l}["${l === 'bin' ? 'bin (launcher)' : l === 'vendor' ? 'vendor (bundled)' : `src/${l}`}"]`);
    for (const id of all.filter((i) => layer(i) === l)) lines.push(`    ${nid(id)}["${label(id).replace(/^[a-z]+\//, (m) => (l === 'vendor' ? m : ''))}"]`);
    lines.push('  end');
  }
  for (const e of edges) lines.push(`  ${nid(e.from)} ${e.dynamic ? '-.->' : '-->'} ${nid(e.to)}`);
  lines.push('```');
  const graphMd = lines.join('\n');

  const count = new Map();
  for (const e of edges) { const k = `${layer(e.from)}>${layer(e.to)}`; if (layer(e.from) !== layer(e.to)) count.set(k, (count.get(k) || 0) + 1); }
  const sum = ['```mermaid', 'flowchart LR'];
  for (const l of layers) sum.push(`  ${l}["${l === 'bin' ? 'bin' : l === 'vendor' ? 'vendor' : `src/${l}`}"]`);
  for (const [k, n] of [...count].sort()) { const [a, b] = k.split('>'); sum.push(`  ${a} -->|"${n}"| ${b}`); }
  sum.push('```');

  const out = new Map(); const inn = new Map();
  for (const e of edges) { (out.get(e.from) || out.set(e.from, []).get(e.from)).push(e.to); (inn.get(e.to) || inn.set(e.to, []).get(e.to)).push(e.from); }
  const short = (ids) => (ids || []).map((i) => `\`${label(i)}\``).join(', ') || 'none';
  const rows = ['| Module | What it is | Imports | Imported by |', '|---|---|---|---|'];
  for (const n of nodes) rows.push(`| \`${n.id}\` | ${n.purpose || (n.id.startsWith('bin/') ? 'The `memev` command: calls `main` in `cli/main.mjs`' : '')} | ${short(out.get(n.id))} | ${short(inn.get(n.id))} |`);

  return { graphMd, summaryMd: sum.join('\n'), table: rows.join('\n'), modules: nodes.length, edges: edges.length, dynamic: edges.filter((e) => e.dynamic).length };
}

export function page(graph) {
  const r = render(graph);
  return `# Module map

Part of the [Memev documentation](README.md). Written by \`node scripts/docs/module-graph.mjs\` from the real imports in \`bin/\` and \`src/\`; do not edit it by hand. \`node scripts/docs/module-graph.mjs --check\` (and \`test/docs-module-map.test.mjs\`) fail when it is out of date. How the parts fit at a higher level: [ARCHITECTURE.md](ARCHITECTURE.md).

${r.modules} modules and ${r.edges} import edges (${r.dynamic} of them are loaded on demand with \`import()\`, drawn dashed). Memev has no runtime dependencies: only Node built-ins and the code under \`vendor/\`.

## Layers

\`bin/memev.mjs\` starts the command line. \`src/cli\` holds the commands, \`src/server\` the HTTP and MCP server the daemon runs, \`src/engine\` the vault, log, index, graph, tokens, licence and bus, and \`src/services\` the list of service providers. The numbers are import edges between layers.

${r.summaryMd}

## Every module

Solid arrows are imports at load time, dashed arrows are imports on demand.

${r.graphMd}

## Per module

Import paths are relative to \`src/\`. \`none\` under "Imported by" means no other module in \`bin/\` or \`src/\` names it: it is the entry point, or it is started as its own process or only by a test.

${r.table}
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const g = buildGraph();
  if (process.argv.includes('--json')) { console.log(JSON.stringify(g, null, 2)); process.exit(0); }
  const text = page(g);
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (cur !== text) { console.error('docs/MODULES.md is out of date: run node scripts/docs/module-graph.mjs'); process.exit(1); }
    console.log('docs/MODULES.md is up to date'); process.exit(0);
  }
  fs.writeFileSync(OUT, text);
  console.log(`wrote docs/MODULES.md (${g.nodes.length} modules, ${g.edges.length} edges)`);
}
