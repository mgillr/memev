// SPDX-License-Identifier: Apache-2.0
// The rotation candidates side by side: what a computer on the old code reads, how big the largest file gets at the volumes in
// VAULT-GROWTH-MODEL.md, and at the longest message the bus allows.
//   node scripts/bench/speed/lab/bus-rotation-layouts.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bus as OldBus } from '../../../../test/fixtures/bus-main-oracle.mjs';

const device = 'dev_layouttest00'; const HOST = { id: device, kind: 'host', label: 'pc', status: 'active' };
const devices = { hostId: device, get: () => HOST, list: () => [HOST] };
const line = (i, ts, body) => JSON.stringify({ id: `layoutte-${i}`, dseq: i, ts, device, from: 'a@pc', operator: false, to: 'all', type: 'status', body, ref: null, project: null });
const CAP = 4 * 1048576;
const LAYOUTS = {
  'R1 nested monthly, log/<device>/<YYYY-MM>.jsonl (the proposal)': (ts) => `${device}/${ts.slice(0, 7)}.jsonl`,
  'R2 flat monthly, log/<device>.<YYYY-MM>.jsonl': (ts) => `${device}.${ts.slice(0, 7)}.jsonl`,
  'R3 flat by size, log/<device>.jsonl then log/<device>.<n>.jsonl': null,
};
function write(dir, name, perMonth, months, bodyLen) {
  const root = fs.mkdtempSync(path.join(dir, 'l-')); fs.mkdirSync(path.join(root, 'bus/log'), { recursive: true });
  const body = 'x'.repeat(bodyLen); const sizes = new Map(); let i = 0; let n = 1; let size = 0; const start = Date.parse('2026-01-01T00:00:00Z'); const MONTH = 30 * 86400e3;
  const fds = new Map();
  for (let mo = 0; mo < months; mo++) for (let k = 0; k < perMonth; k++) {
    i++; const ts = new Date(start + mo * MONTH + (k * MONTH) / perMonth).toISOString(); const l = `${line(i, ts, body)}\n`;
    let f; if (LAYOUTS[name]) f = LAYOUTS[name](ts); else { if (size >= CAP) { n++; size = 0; } f = n === 1 ? `${device}.jsonl` : `${device}.${n}.jsonl`; size += l.length; }
    sizes.set(f, (sizes.get(f) || 0) + l.length);
    let fd = fds.get(f); if (!fd) { fs.mkdirSync(path.dirname(path.join(root, 'bus/log', f)), { recursive: true }); fd = fs.openSync(path.join(root, 'bus/log', f), 'a'); fds.set(f, fd); }
    fs.writeSync(fd, l);
  }
  for (const fd of fds.values()) fs.closeSync(fd);
  const read = new OldBus({ root, devices }).all().length;
  fs.rmSync(root, { recursive: true, force: true });
  return { messages: i, old_code_reads: read, files: sizes.size, largest_mb: Math.round(Math.max(...sizes.values()) / 10485.76) / 100 };
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-bus-layouts-'));
for (const name of Object.keys(LAYOUTS)) {
  console.log(name);
  console.log('  fleet, 30,000 a month of 340 characters, 3 months', JSON.stringify(write(dir, name, 30000, 3, 340)));
  console.log('  fleet with the longest message, 30,000 a month of 4,000 characters, 1 month', JSON.stringify(write(dir, name, 30000, 1, 4000)));
}
fs.rmSync(dir, { recursive: true, force: true });
