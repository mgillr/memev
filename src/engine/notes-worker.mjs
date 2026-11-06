// SPDX-License-Identifier: Apache-2.0
// Background work on the saved note state, off the thread that serves requests.
//   sweep: hash every note and name the ones whose bytes do not match the log. What to do about one is decided on the main thread,
//          which reads the note again: by then a write may have moved the log on, and text that is not valid UTF-8 hashes differently here.
//          The index's own files are checked first, against the sums in their head (segment.mjs).
//   fold:  merge the old journal into the base (notestate.mjs).
//   index: build a whole index generation from the notes, after damage was found while serving.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { foldFiles, scanNotes } from './notestate.mjs';
import { writeSeg, verifySegFiles, readHead, SegDamage } from './segment.mjs';
import { docsOfNotes } from './segment-index.mjs';

const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const nap = new Int32Array(new SharedArrayBuffer(4));
function hashOf(file, buf) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW);
  try { const h = crypto.createHash('sha256'); let pos = 0, n; while ((n = fs.readSync(fd, buf, 0, buf.length, pos)) > 0) { h.update(buf.subarray(0, n)); pos += n; } return { hash: h.digest('hex'), bytes: pos }; }
  finally { fs.closeSync(fd); }
}
/** True when a folder on the way down from the vault root is a link. O_NOFOLLOW guards only the last name. Each folder is asked once per sweep. */
function linkAbove(root, p, seen) {
  let cur = root, rel = ''; const segs = p.split('/');
  for (let i = 0; i < segs.length - 1; i++) {
    rel = rel ? `${rel}/${segs[i]}` : segs[i]; cur = path.join(cur, segs[i]); let linked = seen.get(rel);
    if (linked === undefined) { try { linked = fs.lstatSync(cur).isSymbolicLink(); } catch { linked = false; } seen.set(rel, linked); }
    if (linked) return true;
  }
  return false;
}
function sweep({ root, items, segment, restEvery = 64 * 1024 * 1024, restMs = 0 }) {
  if (segment) { let why = null; try { why = verifySegFiles(segment.dir, readHead(segment.dir)); } catch (e) { why = e instanceof SegDamage ? e.why : e.message; } parentPort.postMessage({ type: 'segment', gen: segment.gen, why }); }
  const buf = Buffer.allocUnsafe(1 << 20); let hashed = 0, bytes = 0, missing = 0, sinceRest = 0; const seen = new Map();
  const notFound = (p, reason) => { missing++; parentPort.postMessage({ type: 'missing', path: p, reason }); };
  for (const line of items.split('\n')) {
    if (!line) continue;
    const ch = line.slice(0, 64), p = line.slice(65); const file = path.join(root, ...p.split('/'));
    if (linkAbove(root, p, seen)) { notFound(p, 'a folder on the way is a link'); continue; }
    let got = null, reason = 'gone';
    try { got = hashOf(file, buf); } catch (e) { reason = e.code === 'ELOOP' ? 'it is a link' : e.code === 'EISDIR' ? 'it is a folder' : e.code === 'ENOENT' ? 'gone' : e.code || e.message; if (p.startsWith('work/') && !linkAbove(root, `work/archive/${p.slice(5)}`, seen)) { try { got = hashOf(path.join(root, 'work', 'archive', ...p.slice(5).split('/')), buf); } catch {} } }
    if (!got) { notFound(p, reason); continue; }
    hashed++; bytes += got.bytes; sinceRest += got.bytes;
    if (got.hash !== ch) parentPort.postMessage({ type: 'differs', path: p });
    if (hashed % 512 === 0) parentPort.postMessage({ type: 'progress', hashed, bytes, missing });
    if (restMs && sinceRest >= restEvery) { sinceRest = 0; Atomics.wait(nap, 0, 0, restMs); }
  }
  parentPort.postMessage({ type: 'done', hashed, bytes, missing });
}
/** The same sections a rebuild at open writes: the walk's notes in path order, each read once. */
function buildIndex({ root, dir }) {
  const scan = scanNotes(root);
  function* notes() { for (const p of [...scan.keys()].sort()) { let body; try { body = fs.readFileSync(path.join(root, ...p.split('/')), 'utf8'); } catch { continue; } yield [p, body]; } }
  writeSeg(dir, docsOfNotes(notes()));
}

if (workerData?.job === 'sweep') sweep(workerData);
else if (workerData?.job === 'fold') { foldFiles(workerData.state); parentPort.postMessage({ type: 'done' }); }
else if (workerData?.job === 'index') { buildIndex(workerData); parentPort.postMessage({ type: 'done' }); }
