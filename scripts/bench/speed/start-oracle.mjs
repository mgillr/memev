#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Same answers: recall on a just-opened vault, its graph still waiting behind the start, against the graph main's code builds by reading
// every note, and against itself once the graph has been taken in. Includes a broken control, so it can fail.
//   node scripts/bench/speed/start-oracle.mjs --root <copy> --oracle <checkout of main> [--queries bench/queries.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2); const one = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const root = path.resolve(one('root', '')); const oracle = path.resolve(one('oracle', ''));
const { Vault } = await import(path.join(here, 'src/engine/vault.mjs'));
const { Graph: MainGraph } = await import(path.join(oracle, 'src/engine/graph.mjs'));
const ME = { id: 'o', agent: 'oracle', scopes: ['read', 'write'], paths: ['**'] };
const raw = JSON.parse(fs.readFileSync(one('queries', path.join(here, 'bench/queries.json')), 'utf8'));
const queries = (Array.isArray(raw) ? raw : raw.queries || Object.values(raw).flat()).map((q) => (typeof q === 'string' ? q : q.q || q.query || q.prompt)).filter(Boolean);
const v = new Vault(root, { git: false, fsync: false }).open();
// prompts drawn from the notes themselves, so synthetic fixtures get hits too
const all = v.allNotes(); for (let i = 0, k = Number(one('sample', 300)); i < k; i++) { const b = v._read(all[Math.floor((i + 0.5) * all.length / k)]) || ''; const w = b.split(/\s+/); const at = Math.floor(w.length / 2); queries.push(w.slice(at, at + 4).join(' ')); }
const waiting = v.graph.pending.size;
const ask = () => queries.map((q) => v.recall(ME, { query: q, log: false, limit: 10 }));
const early = ask();
const stillWaiting = v.graph.pending.size;
const main = new MainGraph(); for (const p of v.allNotes()) { const b = v._read(p); if (b !== null) main.indexNote(p, b); }
const mainRelated = (h) => (main.sectionEnts.get(`${h.path}#${h.heading || ''}`) || []).slice(0, 5).map((id) => main.entities.get(id)?.name).filter(Boolean);
let hits = 0, withRelated = 0, bad = 0, badControl = 0;
early.forEach((a) => { for (const h of a) { hits++; const want = mainRelated(h); if (want.length) withRelated++; if (JSON.stringify(want) !== JSON.stringify(h.related)) { bad++; if (bad < 4) console.log('differs', h.path, h.heading, want, h.related); } if (JSON.stringify(want) !== JSON.stringify([...h.related].reverse())) badControl++; } });
v.graph.finish();
const late = ask(); let badLate = 0; late.forEach((a, i) => { if (JSON.stringify(a) !== JSON.stringify(early[i])) badLate++; });
const stats = { entities: [v.graph.stats().entities, main.stats().entities], pairs: [v.graph.stats().co_occurrences, main.stats().co_occurrences] };
console.log(JSON.stringify({ queries: queries.length, waiting, stillWaiting, hits, withRelated, differs_from_main: bad, broken_control_differs: badControl, early_vs_late_differs: badLate, stats }));
v.close();
const fail = bad || badLate || !badControl || !hits || !withRelated || stats.entities[0] !== stats.entities[1] || stats.pairs[0] !== stats.pairs[1];
process.exit(fail ? 1 : 0);
