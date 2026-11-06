// SPDX-License-Identifier: Apache-2.0
// Loop 2 and 3 of the bus search: what the first read costs and what it keeps in memory, by way of holding the messages.
//   node --expose-gc scripts/bench/speed/lab/bus-cold.mjs --messages 100000 --repeats 3
// Each way is timed in this process in turn; numbers are thread CPU ms (the box is shared) and retained heap MB after a collection.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-bus-cold-'));
const lines = genLog();
// one flat file, and the same lines in segments of the size the bus uses
const flat = path.join(dir, 'flat.jsonl'); fs.writeFileSync(flat, `${lines.join('\n')}\n`);
const segs = []; { let buf = []; let size = 0; for (const l of lines) { buf.push(l); size += l.length + 1; if (size >= SEG) { const f = path.join(dir, `seg${segs.length}.jsonl`); fs.writeFileSync(f, `${buf.join('\n')}\n`); segs.push(f); buf = []; size = 0; } } if (buf.length) { const f = path.join(dir, `seg${segs.length}.jsonl`); fs.writeFileSync(f, `${buf.join('\n')}\n`); segs.push(f); } }

const parseFile = (f) => { const out = []; for (const line of fs.readFileSync(f, 'utf8').split('\n')) { if (!line.trim()) continue; try { const m = JSON.parse(line); if (m?.id && m.device && Number.isInteger(m.dseq)) out.push(m); } catch {} } return out; };

// a sidecar written once, for the sealed-segment candidates
const side = path.join(dir, 'side.bin');
{ const all = parseFile(flat); fs.writeFileSync(side, v8.serialize(all)); }
const heads = path.join(dir, 'heads.bin');
{ const all = parseFile(flat); let off = 0; const rows = all.map((m) => { const { body, ...h } = m; const line = JSON.stringify(m); const at = off; off += Buffer.byteLength(line) + 1; return { ...h, _at: at, _len: Buffer.byteLength(line) }; }); fs.writeFileSync(heads, v8.serialize(rows)); }

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
  // L2-C4 snapshot of the parsed objects: what a sidecar buys if it holds everything
  'sidecar, whole objects': () => v8.deserialize(fs.readFileSync(side)),
  // L3-crazy sealed sidecar of headers only, bodies stay in the log and are read when shown; nothing is parsed or validated at the first read
  'sidecar, headers only': () => v8.deserialize(fs.readFileSync(heads)),
};

const cpu = (fn) => { const c = process.cpuUsage(); const t = performance.now(); const v = fn(); const u = process.cpuUsage(c); return { v, cpu: (u.user + u.system) / 1000, wall: performance.now() - t }; };
const rows = {};
for (let n = 0; n < REPEATS; n++) for (const [name, fn] of Object.entries(WAYS)) {
  globalThis.gc?.(); const h0 = process.memoryUsage().heapUsed; const ext0 = process.memoryUsage().external;
  const r = cpu(fn);
  globalThis.gc?.(); const heap = (process.memoryUsage().heapUsed - h0) / 1048576; const count = r.v.length;
  (rows[name] ||= []).push({ cpu: r.cpu, wall: r.wall, heap, count });
}
console.log(`messages ${M} flat ${(fs.statSync(flat).size / 1048576).toFixed(1)} MB segments ${segs.length} load ${os.loadavg()[0].toFixed(1)}`);
for (const [name, rs] of Object.entries(rows)) { const q = (k) => rs.map((r) => r[k]).sort((a, b) => a - b); const c = q('cpu'); const h = q('heap'); console.log(`${name.padEnd(26)} cpu ${c[Math.floor(c.length / 2)].toFixed(0).padStart(6)} ms (${c[0].toFixed(0)} to ${c.at(-1).toFixed(0)})  retained ${h[Math.floor(h.length / 2)].toFixed(0).padStart(4)} MB  messages ${rs[0].count}`); }
// reading one body back from the log, for the ways that dropped them
{ const fd = fs.openSync(flat, 'r'); const t = performance.now(); for (let i = 0; i < 1000; i++) { const b = Buffer.alloc(600); fs.readSync(fd, b, 0, 600, i * 500); } fs.closeSync(fd); console.log(`read back a body: ${((performance.now() - t) / 1000).toFixed(3)} ms each`); }
fs.rmSync(dir, { recursive: true, force: true });
