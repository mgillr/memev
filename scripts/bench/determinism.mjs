// SPDX-License-Identifier: Apache-2.0
// Makes a benchmark run repeatable: a clock that only moves when the harness moves it, seeded randomness
// (the ids and tokens Memev draws from crypto.randomBytes, and Math.random) and a fixed host name. Installed once,
// before the code under test is imported, and only in the benchmark process.
import crypto from 'node:crypto';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';

export const START = '2026-10-27T12:00:00.000Z';
const RealDate = Date;
let nowMs = RealDate.parse(START);
let state = 0;

// splitmix32: small, fast and good enough for ids
function next32() {
  state = (state + 0x9e3779b9) | 0;
  let z = state;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}
function fill(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let i = 0; i < b.length; i += 4) { const v = next32(); for (let j = 0; j < 4 && i + j < b.length; j++) b[i + j] = (v >>> (8 * j)) & 0xff; }
  return buf;
}

let installed = false;
export function install({ seed = 1 } = {}) {
  state = seed | 0;
  nowMs = RealDate.parse(START);
  if (installed) return;
  installed = true;
  class BenchDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(nowMs); }
    static now() { return nowMs; }
  }
  globalThis.Date = BenchDate;
  Math.random = () => next32() / 2 ** 32;
  crypto.randomBytes = (n, cb) => { const b = fill(Buffer.alloc(n)); if (cb) { process.nextTick(cb, null, b); return undefined; } return b; };
  crypto.randomFillSync = (buf) => fill(buf);
  crypto.randomUUID = () => {
    const b = fill(Buffer.alloc(16)); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = b.toString('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  os.hostname = () => 'bench-host';
  syncBuiltinESMExports();
}

export const clock = {
  now: () => nowMs,
  advance(ms) { nowMs += ms; },
  set(iso) { nowMs = RealDate.parse(iso); },
};
