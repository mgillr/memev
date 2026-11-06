// SPDX-License-Identifier: Apache-2.0
// Generated notes for the speed benches, with a spread of sizes and a word curve. Seeded, so the same count gives the
// same notes. Domain words sit at the head of the curve, so a real query competes with other notes as it would in a vault. Generated text only.
import fs from 'node:fs';
import path from 'node:path';

// ---- vocabulary: domain words at the head of a Zipf curve so distractors compete with the labelled notes on the words real prompts use
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const DOMAIN = ('deploy pipeline cache layer database migration login error retry queue worker invoice report export schema index token config docker build test flaky timeout endpoint handler service client server metric alert latency memory disk backup restore branch merge review release feature bug fix refactor stripe webhook tenant postgres redis kafka terraform kubernetes sentry grafana playwright lockfile locale timezone pagination serializer idempotency benchmark rollback canary').split(' ');
const SYL = ['ka', 'lo', 'mi', 'ten', 'ra', 'su', 'vor', 'eli', 'dan', 'pex', 'qui', 'zo', 'bar', 'nel', 'tis', 'gru'];
function vocab(n) { const v = [...DOMAIN]; for (let i = 0; v.length < n; i++) v.push(SYL[i % 16] + SYL[(i >> 4) % 16] + SYL[(i >> 8) % 16] + (i >= 4096 ? SYL[(i >> 12) % 16] : '') + (i >= 65536 ? 'x' : '')); return v; }
const VOCAB = vocab(60000);
function wordPool(r, size = 1 << 21) { const H = VOCAB.map((_, i) => 1 / (i + 1)); const HS = H.reduce((a, b) => a + b, 0); const CDF = new Float64Array(VOCAB.length); let acc = 0; H.forEach((h, i) => { acc += h / HS; CDF[i] = acc; }); const pool = new Uint32Array(size); for (let i = 0; i < size; i++) { const x = r(); let lo = 0, hi = CDF.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (CDF[m] < x) lo = m + 1; else hi = m; } pool[i] = lo; } return pool; }

const HIST = {
  // A spread of Markdown file sizes, chosen for the bench: bin b holds sizes in [2^(b-1), 2^b), most notes small and a few very large.
  memory: [[8, 5], [9, 25], [10, 35], [11, 190], [12, 140], [13, 15], [14, 10], [15, 5], [16, 1], [17, 1], [19, 2], [20, 1]],
};
function sizer(r, name) { const h = HIST[name]; const tot = h.reduce((a, [, c]) => a + c, 0); return () => { let x = r() * tot; for (const [b, c] of h) { if (x < c) { return Math.floor(2 ** (b - 1 + r())); } x -= c; } return 2048; }; }
const PROJ = ['billing', 'search', 'mobile-app', 'infra', 'docs', 'analytics', 'auth', 'notifications', 'checkout', 'data-pipeline'];

export function genNotes(rootDir, n, dist, seed) {
  const r = prng(seed); const pool = wordPool(r); const size = sizer(r, dist); let bytes = 0, sections = 0, largest = 0, uniq = 0;
  const mask = pool.length - 1;
  for (let i = 0; i < n; i++) {
    const target = size(); let p = Math.floor(r() * pool.length);
    const parts = [`# note ${i}\n`]; let len = parts[0].length;
    if (r() < 0.5) { const l = `\nProject: ${PROJ[i % PROJ.length]}\n`; parts.push(l); len += l.length; }
    let sinceHead = 0, sent = 0;
    while (len < target) {
      if (sinceHead === 0 || sinceHead > 1000) { const h = `\n## ${VOCAB[pool[p++ & mask]]} ${VOCAB[pool[p++ & mask]]} t${(uniq++).toString(36)}\n`; parts.push(h); len += h.length; sections++; sinceHead = 1; p = Math.floor(r() * pool.length); }
      let s = ''; for (let w = 0; w < 14; w++) s += `${VOCAB[pool[p++ & mask]]} `; sent++; s += sent % 8 === 0 ? `x${(uniq++).toString(36)}.\n` : `.\n`; parts.push(s); len += s.length; sinceHead += s.length;
    }
    const body = parts.join(''); const hex = (i & 255).toString(16).padStart(2, '0');
    const dir = path.join(rootDir, 'notes', hex); if (i < 256) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `n${i}.md`), body); bytes += body.length; largest = Math.max(largest, body.length);
  }
  return { notes: n, bytes, sections, mean_note_bytes: Math.round(bytes / Math.max(1, n)), largest, dist };
}
