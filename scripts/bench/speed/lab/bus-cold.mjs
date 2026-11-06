// SPDX-License-Identifier: Apache-2.0
// Loop 2 and 3 of the bus search: what the first read costs and what it keeps in memory, by way of holding the messages.
//   node --expose-gc scripts/bench/speed/lab/bus-cold.mjs --messages 100000 --repeats 3
// Each way runs in a process of its own, in turn; numbers are process CPU ms (the box is shared) and retained heap plus array buffers after a collection.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const M = Number(arg('messages', 100000)); const REPEATS = Number(arg('repeats', 3)); const SEATS = 50; const SEG = 4 * 1048576;
const prng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const MIX = [['status', 60], ['ack', 20], ['question', 5], ['answer', 5], ['task', 3], ['claim', 3], ['verdict', 2.5], ['restate', 1.5]];
const WORDS = Array.from({ length: 4000 }, (_, i) => `w${(i * 2654435761 >>> 0).toString(36)}`);
const device = 'dev_benchhost00000';
function genLog() {
  const r = prng(17); const tasks = []; const start = Date.parse('2026-01-01T00:00:00Z'); const lines = [];
  for (let i = 1; i <= M; i++) {
    let x = r() * 100; let type = 'status';
    for (const [t, w] of MIX) { if (x < w) { type = t; break; } x -= w; }
    let ref = null;
    if (['claim', 'verdict', 'restate'].includes(type)) { if (tasks.length) ref = tasks[Math.floor(r() * tasks.length)]; else type = 'status'; }
    const id = `${device.slice(4, 12)}-${i}`; if (type === 'task') tasks.push(id);
    let body = ''; while (body.length < 330) body += `${WORDS[Math.floor(r() * r() * WORDS.length)]} `;
    lines.push(JSON.stringify({ id, dseq: i, ts: new Date(start + i * 1000).toISOString(), device, from: `bot${i % SEATS}@fleet`, operator: false, to: type === 'task' ? `bot${(i + 1) % SEATS}@fleet` : 'all', type, body, ref, project: null }));
  }
  return lines;
}
const ONLY = arg('only', null);
const dir = ONLY ? arg('dir') : fs.mkdtempSync(path.join(os.tmpdir(), 'memev-bus-cold-'));
const flat = path.join(dir, 'flat.jsonl'); const side = path.join(dir, 'side.bin'); const heads = path.join(dir, 'heads.bin'); const colsFile = path.join(dir, 'cols.bin'); const colsTable = path.join(dir, 'cols.json');
const segs = [];
const parseFile = (f) => { const out = []; for (const line of fs.readFileSync(f, 'utf8').split('\n')) { if (!line.trim()) continue; try { const m = JSON.parse(line); if (m?.id && m.device && Number.isInteger(m.dseq)) out.push(m); } catch {} } return out; };
if (!ONLY) {
const lines = genLog();
// one flat file, and the same lines in segments of the size the bus uses
fs.writeFileSync(flat, `${lines.join('\n')}\n`);
{ let buf = []; let size = 0; for (const l of lines) { buf.push(l); size += l.length + 1; if (size >= SEG) { const f = path.join(dir, `seg${segs.length}.jsonl`); fs.writeFileSync(f, `${buf.join('\n')}\n`); segs.push(f); buf = []; size = 0; } } if (buf.length) { const f = path.join(dir, `seg${segs.length}.jsonl`); fs.writeFileSync(f, `${buf.join('\n')}\n`); segs.push(f); } }

// a sidecar written once, for the sealed-segment candidates
{ const all = parseFile(flat); fs.writeFileSync(side, v8.serialize(all)); }
{ const all = parseFile(flat); let off = 0; const rows = all.map((m) => { const { body, ...h } = m; const line = JSON.stringify(m); const at = off; off += Buffer.byteLength(line) + 1; return { ...h, _at: at, _len: Buffer.byteLength(line) }; }); fs.writeFileSync(heads, v8.serialize(rows));
  // columns: fixed-width arrays over a table of the strings that repeat
  const table = new Map(); const idx = (s) => { const k = s === null ? '' : String(s); let i = table.get(k); if (i === undefined) { i = table.size; table.set(k, i); } return i; };
  const n = all.length; const buf = new ArrayBuffer(n * 36); const dseq = new Float64Array(buf, 0, n); const tsMs = new Float64Array(buf, n * 8, n); const at = new Float64Array(buf, n * 16, n); const from = new Int32Array(buf, n * 24, n); const type = new Int16Array(buf, n * 28, n); const to = new Int32Array(buf, n * 30 - (n * 30) % 4, 0); void to; void type;
  let o = 0; const fromTo = new Int32Array(n * 3);
  all.forEach((m, i) => { dseq[i] = m.dseq; tsMs[i] = Date.parse(m.ts); at[i] = o; o += Buffer.byteLength(JSON.stringify(m)) + 1; fromTo[i * 3] = idx(m.from); fromTo[i * 3 + 1] = idx(m.to); fromTo[i * 3 + 2] = idx(m.ref); });
  fs.writeFileSync(colsFile, Buffer.concat([Buffer.from(dseq.buffer, dseq.byteOffset, n * 8), Buffer.from(tsMs.buffer, tsMs.byteOffset, n * 8), Buffer.from(at.buffer, at.byteOffset, n * 8), Buffer.from(fromTo.buffer)]));
  fs.writeFileSync(colsTable, JSON.stringify([...table.keys()]));
}
fs.writeFileSync(path.join(dir, 'segs.json'), JSON.stringify(segs));
}
if (ONLY) segs.push(...JSON.parse(fs.readFileSync(path.join(dir, 'segs.json'), 'utf8')));

const WAYS = {
  // today's way
  'parse flat': () => parseFile(flat),
  // L2-C1 the same bytes in segments: the split and the big string cost less
  'parse segments': () => segs.flatMap(parseFile),
  // L2-C2 known: one string per distinct device, seat and type
  'parse + intern': () => {
    const t = new Map(); const I = (s) => { if (typeof s !== 'string') return s; const h = t.get(s); if (h !== undefined) return h; t.set(s, s); return s; };
    return parseFile(flat).map((m) => { m.device = I(m.device); m.from = I(m.from); m.to = I(m.to); m.type = I(m.type); return m; });
  },
  // L2-C3 splice of a column store's late materialisation and the log's own bytes: drop each body after validating it, keep where it is
  'parse, drop bodies': () => {
    const text = fs.readFileSync(flat); const out = []; let at = 0;
    while (at < text.length) {
      let nl = text.indexOf(10, at); if (nl < 0) nl = text.length;
      try { const m = JSON.parse(text.latin1Slice(at, nl)); if (m?.id && m.device && Number.isInteger(m.dseq)) { m.body = undefined; m._at = at; m._len = nl - at; out.push(m); } } catch {}
      at = nl + 1;
    }
    return out;
  },
  // L2-C5 known: no split of the whole text, one slice a line
  'parse, no split': () => {
    const text = fs.readFileSync(flat, 'utf8'); const out = []; let at = 0;
    while (at < text.length) {
      let nl = text.indexOf('\n', at); if (nl < 0) nl = text.length;
      if (text.charCodeAt(at) === 123 || text.slice(at, nl).trim()) { try { const m = JSON.parse(text.slice(at, nl)); if (m?.id && m.device && Number.isInteger(m.dseq)) out.push(m); } catch {} }
      at = nl + 1;
    }
    return out;
  },
  // L2-C4 snapshot of the parsed objects: what a sidecar buys if it holds everything
  'sidecar, whole objects': () => v8.deserialize(fs.readFileSync(side)),
  // L3-crazy sealed sidecar of headers only, bodies stay in the log and are read when shown; nothing is parsed or validated at the first read
  'sidecar, headers only': () => v8.deserialize(fs.readFileSync(heads)),
  // L3-crazy, the assumption after that one fell: no message objects at all until one is shown
  'sidecar, columns': () => { const b = fs.readFileSync(colsFile); const t = JSON.parse(fs.readFileSync(colsTable, 'utf8')); return { length: b.length / 36, b, t }; },
};

const cpu = (fn) => { const c = process.cpuUsage(); const t = performance.now(); const v = fn(); const u = process.cpuUsage(c); return { v, cpu: (u.user + u.system) / 1000, wall: performance.now() - t }; };
if (ONLY) {
  globalThis.gc(); const u0 = process.memoryUsage();
  const r = cpu(WAYS[ONLY]);
  globalThis.gc(); const u1 = process.memoryUsage();
  console.log(JSON.stringify({ cpu: r.cpu, wall: r.wall, heap: (u1.heapUsed + u1.arrayBuffers - u0.heapUsed - u0.arrayBuffers) / 1048576, count: r.v.length }));
  process.exit(0);
}
const rows = {};
for (let n = 0; n < REPEATS; n++) for (const name of Object.keys(WAYS)) {
  const c = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--only', name, '--dir', dir, '--messages', String(M)], { encoding: 'utf8' });
  if (c.status) throw new Error(c.stderr);
  (rows[name] ||= []).push(JSON.parse(c.stdout));
}
console.log(`messages ${M} flat ${(fs.statSync(flat).size / 1048576).toFixed(1)} MB segments ${segs.length} load ${os.loadavg()[0].toFixed(1)}`);
for (const [name, rs] of Object.entries(rows)) { const q = (k) => rs.map((r) => r[k]).sort((a, b) => a - b); const c = q('cpu'); const h = q('heap'); console.log(`${name.padEnd(26)} cpu ${c[Math.floor(c.length / 2)].toFixed(0).padStart(6)} ms (${c[0].toFixed(0)} to ${c.at(-1).toFixed(0)})  retained ${h[Math.floor(h.length / 2)].toFixed(0).padStart(4)} MB  messages ${rs[0].count}`); }
// reading one body back from the log, for the ways that dropped them
{ const fd = fs.openSync(flat, 'r'); const t = performance.now(); for (let i = 0; i < 1000; i++) { const b = Buffer.alloc(600); fs.readSync(fd, b, 0, 600, i * 500); } fs.closeSync(fd); console.log(`read back a body: ${((performance.now() - t) / 1000).toFixed(3)} ms each`); }
fs.rmSync(dir, { recursive: true, force: true });
