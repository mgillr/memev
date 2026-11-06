// SPDX-License-Identifier: Apache-2.0
// Background work on the saved note state, off the thread that serves requests.
//   sweep: hash every note and name the ones whose bytes do not match the log. What to do about one is decided on the main thread,
//          which reads the note again: by then a write may have moved the log on, and text that is not valid UTF-8 hashes differently here.
//   fold:  merge the old journal into the base (notestate.mjs).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { foldFiles } from './notestate.mjs';

const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const nap = new Int32Array(new SharedArrayBuffer(4));
function hashOf(file, buf) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW);
  try { const h = crypto.createHash('sha256'); let pos = 0, n; while ((n = fs.readSync(fd, buf, 0, buf.length, pos)) > 0) { h.update(buf.subarray(0, n)); pos += n; } return { hash: h.digest('hex'), bytes: pos }; }
  finally { fs.closeSync(fd); }
}
function sweep({ root, items, restEvery = 64 * 1024 * 1024, restMs = 0 }) {
  const buf = Buffer.allocUnsafe(1 << 20); let hashed = 0, bytes = 0, missing = 0, sinceRest = 0;
  for (const line of items.split('\n')) {
    if (!line) continue;
    const ch = line.slice(0, 64), p = line.slice(65); const file = path.join(root, ...p.split('/'));
    let got = null;
    try { got = hashOf(file, buf); } catch { if (p.startsWith('work/')) { try { got = hashOf(path.join(root, 'work', 'archive', ...p.slice(5).split('/')), buf); } catch {} } }
    if (!got) { missing++; continue; }
    hashed++; bytes += got.bytes; sinceRest += got.bytes;
    if (got.hash !== ch) parentPort.postMessage({ type: 'differs', path: p });
    if (hashed % 512 === 0) parentPort.postMessage({ type: 'progress', hashed, bytes, missing });
    if (restMs && sinceRest >= restEvery) { sinceRest = 0; Atomics.wait(nap, 0, 0, restMs); }
  }
  parentPort.postMessage({ type: 'done', hashed, bytes, missing });
}

if (workerData?.job === 'sweep') sweep(workerData);
else if (workerData?.job === 'fold') { foldFiles(workerData.state); parentPort.postMessage({ type: 'done' }); }
