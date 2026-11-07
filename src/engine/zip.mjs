// SPDX-License-Identifier: Apache-2.0
// A minimal ZIP reader for chat export files: stored and DEFLATE entries, zip64 sizes and offsets, no encryption.
// readZip takes a buffer and inflates every entry; listZip and entryStream read a file through a descriptor, so a
// multi-hundred-MB export is never held in memory: only its central directory is read, and one entry is inflated
// as a stream.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';

const EOCD_SIG = 0x06054b50;
const EOCD64_LOC_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CD_SIG = 0x02014b50;
const LH_SIG = 0x04034b50;
const MAX32 = 0xffffffff;
const MAX16 = 0xffff;

function findEOCD(buf) {
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

// the zip64 extended information extra field (0x0001): each value is present only when its 32-bit field is all ones
function zip64Extra(extra, { uncompSize, compSize, localOffset }) {
  let p = 0;
  while (p + 4 <= extra.length) {
    const id = extra.readUInt16LE(p); const len = extra.readUInt16LE(p + 2);
    if (id === 0x0001) {
      let q = p + 4;
      const take = () => { const v = Number(extra.readBigUInt64LE(q)); q += 8; return v; };
      if (uncompSize === MAX32 && q + 8 <= p + 4 + len) uncompSize = take();
      if (compSize === MAX32 && q + 8 <= p + 4 + len) compSize = take();
      if (localOffset === MAX32 && q + 8 <= p + 4 + len) localOffset = take();
      break;
    }
    p += 4 + len;
  }
  return { uncompSize, compSize, localOffset };
}

function parseCentral(cd, count) {
  const entries = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.length; i++) {
    if (cd.readUInt32LE(p) !== CD_SIG) break;
    const method = cd.readUInt16LE(p + 10);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const name = cd.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const extra = cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
    const sizes = zip64Extra(extra, { compSize: cd.readUInt32LE(p + 20), uncompSize: cd.readUInt32LE(p + 24), localOffset: cd.readUInt32LE(p + 42) });
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    entries.push({ name, method, size: sizes.uncompSize, compSize: sizes.compSize, localOffset: sizes.localOffset });
  }
  return entries;
}

export function readZip(buf) {
  const eocd = findEOCD(buf);
  if (eocd < 0) throw new Error('not a zip file: end of central directory not found');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (const e of parseCentral(buf.subarray(cdOffset), count)) {
    const lo = e.localOffset;
    if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== LH_SIG) continue;
    const dataStart = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
    const raw = buf.subarray(dataStart, dataStart + e.compSize);
    let data;
    if (e.method === 0) data = Buffer.from(raw);
    else if (e.method === 8) data = zlib.inflateRawSync(raw);
    else continue;
    entries.push({ name: e.name, data, size: e.size });
  }
  return entries;
}

function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  const n = fs.readSync(fd, b, 0, len, pos);
  return b.subarray(0, n);
}

/** The entries of a zip file on disk, from its central directory only: name, method, sizes and where the data is. */
export function listZip(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 65557 + 20);
    const tail = readAt(fd, size - tailLen, tailLen);
    const e = findEOCD(tail);
    if (e < 0) throw new Error('not a zip file: end of central directory not found');
    let count = tail.readUInt16LE(e + 10);
    let cdSize = tail.readUInt32LE(e + 12);
    let cdOffset = tail.readUInt32LE(e + 16);
    if ((count === MAX16 || cdSize === MAX32 || cdOffset === MAX32) && e >= 20 && tail.readUInt32LE(e - 20) === EOCD64_LOC_SIG) {
      const rec = readAt(fd, Number(tail.readBigUInt64LE(e - 20 + 8)), 56);
      if (rec.length === 56 && rec.readUInt32LE(0) === EOCD64_SIG) {
        count = Number(rec.readBigUInt64LE(32)); cdSize = Number(rec.readBigUInt64LE(40)); cdOffset = Number(rec.readBigUInt64LE(48));
      }
    }
    if (cdOffset + cdSize > size) throw new Error('not a zip file: central directory out of range');
    return parseCentral(readAt(fd, cdOffset, cdSize), count);
  } finally { fs.closeSync(fd); }
}

/** A readable stream of one entry's uncompressed bytes, read from the file as it is consumed. */
export function entryStream(file, entry) {
  const fd = fs.openSync(file, 'r');
  let lh;
  try { lh = readAt(fd, entry.localOffset, 30); } finally { fs.closeSync(fd); }
  if (lh.length < 30 || lh.readUInt32LE(0) !== LH_SIG) throw new Error(`zip entry ${entry.name}: bad local header`);
  const start = entry.localOffset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
  if (entry.method !== 0 && entry.method !== 8) throw new Error(`zip entry ${entry.name}: compression method ${entry.method} is not supported`);
  if (entry.compSize === 0) return Readable.from([]);
  const raw = fs.createReadStream(file, { start, end: start + entry.compSize - 1, highWaterMark: 1 << 20 });
  if (entry.method === 0) return raw;
  const inflate = zlib.createInflateRaw({ chunkSize: 1 << 20 });
  raw.on('error', (err) => inflate.destroy(err));
  return raw.pipe(inflate);
}
