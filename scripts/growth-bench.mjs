#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Growth benchmark: replay a month of heavy multi-app use through the vault and check that memory
// stays bounded, the log stays intact and every note can be rebuilt byte for byte from the log.
//   node --max-old-space-size=256 scripts/growth-bench.mjs --tokens 170000000 [--dir DIR] [--json out.json]
// Session traffic is counted in tokens (about 4 characters each); what Memev stores per turn is what
// the hooks store: the prompt and reply, each capped by journal.max_chars, plus checkpoints, memories
// and one recall per prompt.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { initVault, Vault } from '../src/engine/vault.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const TOKENS = Number(arg('tokens', 170e6));
const MAX_HEAP_MB = Number(arg('max-heap', 256));
const base = arg('dir', fs.mkdtempSync(path.join(process.env.MEMEV_TEST_TMP || os.tmpdir(), 'memev-growth-')));
const root = path.join(base, 'vault');
let seed = 42; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const WORDS = 'deploy pipeline cache layer database migration login error retry queue worker invoice report export schema index token config docker build test flaky timeout endpoint handler service client server metric alert latency memory disk backup restore branch merge review release feature bug fix refactor'.split(' ');
const PROJECTS = ['billing', 'search', 'mobile-app', 'infra', 'docs', 'analytics'];
const CLIENTS = ['claude-code', 'codex', 'cursor', 'gemini-cli'];
// a Zipf-distributed vocabulary of 6,000 made-up words plus the domain words above, like real prose
const SYL = ['ka', 'lo', 'mi', 'ten', 'ra', 'su', 'vor', 'eli', 'dan', 'pex', 'qui', 'zo', 'bar', 'nel', 'tis', 'gru'];
const VOCAB = [...WORDS, ...Array.from({ length: 6000 }, (_, i) => SYL[i % 16] + SYL[Math.floor(i / 16) % 16] + SYL[Math.floor(i / 256) % 16] + (i >= 4096 ? 'x' : ''))];
const H = VOCAB.map((_, i) => 1 / (i + 1)); const HS = H.reduce((a, b) => a + b, 0); const CDF = []; H.reduce((a, h, i) => (CDF[i] = a + h / HS), 0);
const zipf = () => { const r = rnd(); let lo = 0, hi = CDF.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (CDF[m] < r) lo = m + 1; else hi = m; } return VOCAB[lo]; };
const text = (chars) => { let s = ''; while (s.length < chars) s += `${zipf()} `; return s; };
const ID = { id: 'bench', agent: 'bench', scopes: ['read', 'write'], paths: ['**'] };

initVault(root, { template: path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'templates', 'vault') });
const v = new Vault(root, { git: false, fsync: false, keyDir: path.join(base, 'keys') }).open();
let tokens = 0, turns = 0, sessions = 0, maxHeap = 0, maxRss = 0, ops = 0;
const sample = () => { const m = process.memoryUsage(); maxHeap = Math.max(maxHeap, m.heapUsed); maxRss = Math.max(maxRss, m.rss); };
const recallMs = [];
const t0 = performance.now();
const DAYS = 30;
while (tokens < TOKENS) {
  const day = Math.min(DAYS - 1, Math.floor((tokens / TOKENS) * DAYS));
  const client = pick(CLIENTS), project = pick(PROJECTS), sid = `d${day}-s${sessions++}`;
  const n = 20 + Math.floor(rnd() * 120);
  for (let i = 0; i < n && tokens < TOKENS; i++) {
    const promptTok = 50 + Math.floor(rnd() * 1500), replyTok = 500 + Math.floor(rnd() * 40000);
    tokens += promptTok + replyTok; turns++;
    const prompt = `${project} ${text(Math.min(promptTok * 4, 1200))}`;
    const s = performance.now(); v.recall(ID, { query: prompt.slice(0, 300), project, limit: 4, client, session: sid }); recallMs.push(performance.now() - s);
    v.journal(ID, { session: sid, client, role: 'user', text: prompt, project });
    v.journal(ID, { session: sid, client, role: 'assistant', text: text(Math.min(replyTok * 4, 2400)), project });
    ops += 3;
    if (i % 6 === 5) { v.checkpoint(ID, { project, task: `${project} work`, done: [`step ${i - 1}`], doing: `step ${i}`, next: [`step ${i + 1}`], client, session: sid }); ops++; }
    if (i % 15 === 7) { v.remember(ID, { text: `In ${project}, ${text(160)} (#${turns})`, kind: pick(['decision', 'fact', 'gotcha', 'pattern']), project, client }); ops++; }
    if (turns % 200 === 0) sample();
  }
}
sample();
const writeS = (performance.now() - t0) / 1000;
v.close();
// reopen: replay from snapshot, recover, index load
const r0 = performance.now(); const v2 = new Vault(root, { git: false, fsync: false, keyDir: path.join(base, 'keys') }).open(); const reopenMs = performance.now() - r0; sample();
const verify = v2.log.verify(); sample();
const rebuilt = path.join(base, 'rebuilt'); v2.rebuildInto(rebuilt); sample();
let identical = 0, differ = 0;
for (const p of v2.allNotes()) { fs.readFileSync(path.join(rebuilt, p)).equals(fs.readFileSync(path.join(root, p))) ? identical++ : differ++; }
// recall must not touch the log
const iter = v2.log.iterate; v2.log.iterate = () => { throw new Error('recall read the log'); };
const qs = []; for (let i = 0; i < 200; i++) { const s = performance.now(); v2.recall(ID, { query: `${pick(PROJECTS)} ${zipf()} ${zipf()} ${zipf()}`, log: false }); qs.push(performance.now() - s); }
v2.log.iterate = iter;
const st = v2.status(); v2.close();
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return Number(s[Math.floor((s.length - 1) * p)].toFixed(2)); };
const noteBytes = (() => { let b = 0; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name.startsWith('.')) continue; const f = path.join(d, e.name); e.isDirectory() ? walk(f) : (b += fs.statSync(f).size); } }; walk(root); return b; })();
const res = {
  tokens_simulated: tokens, sessions, turns, ops_logged: st.oplog.seq, write_seconds: Number(writeS.toFixed(1)),
  log_mb: Number((st.oplog.bytes / 1048576).toFixed(1)), log_segments: st.oplog.segments, notes: st.index.notes, notes_mb: Number((noteBytes / 1048576).toFixed(1)),
  max_heap_mb: Math.round(maxHeap / 1048576), max_rss_mb: Math.round(maxRss / 1048576), heap_bound_mb: MAX_HEAP_MB,
  reopen_ms: Math.round(reopenMs), verify_ok: verify.ok, rebuild_identical: identical, rebuild_differ: differ,
  recall_ms_p50: pct(qs, 0.5), recall_ms_p95: pct(qs, 0.95), live_recall_ms_p95: pct(recallMs, 0.95), recall_reads_log: false,
};
console.log(JSON.stringify(res, null, 2));
if (arg('json')) fs.writeFileSync(arg('json'), `${JSON.stringify(res, null, 2)}\n`);
if (!arg('keep')) fs.rmSync(base, { recursive: true, force: true });
const ok = res.verify_ok && res.rebuild_differ === 0 && res.max_heap_mb <= MAX_HEAP_MB;
process.exit(ok ? 0 : 1);
