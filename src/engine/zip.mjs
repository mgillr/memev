// SPDX-License-Identifier: Apache-2.0
// A minimal ZIP reader for chat export files: stored and DEFLATE entries, no zip64, no encryption.
import zlib from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LH_SIG = 0x04034b50;
// A zip is a file someone else made, and a few KB of it can inflate to gigabytes. No entry is taken past MAX_ENTRY_BYTES
// and no zip past MAX_TOTAL_BYTES, counted on what really comes out: the sizes in a header can lie, and one set of bytes
// can be listed many times over. The importer only ever reads an entry of 512 KB, so these are generous.
export const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const tooLarge = (name, limit) => Object.assign(new Error(`zip entry too large: ${name} would inflate past ${limit} bytes; refused`), { code: 'zip_too_large' });

function findEOCD(buf) {
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/** Every entry of a zip, inflated. Throws an error with code zip_too_large rather than inflate past the limits above. */
export function readZip(buf) {
  const eocd = findEOCD(buf);
  if (eocd < 0) throw new Error('not a zip file: end of central directory not found');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries = [];
  let total = 0;
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== CD_SIG) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (buf.readUInt32LE(localOffset) !== LH_SIG) continue;
    const lhNameLen = buf.readUInt16LE(localOffset + 26);
    const lhExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lhNameLen + lhExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    if (method !== 0 && method !== 8) continue;
    const limit = Math.min(MAX_ENTRY_BYTES, MAX_TOTAL_BYTES - total);
    if (limit <= 0 || uncompSize > limit || (method === 0 && raw.length > limit)) throw tooLarge(name, limit);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else {
      try { data = zlib.inflateRawSync(raw, { maxOutputLength: limit }); }
      catch (e) { if (e.code === 'ERR_BUFFER_TOO_LARGE') throw tooLarge(name, limit); throw e; }
    }
    total += data.length;
    entries.push({ name, data, size: data.length });
  }
  return entries;
}
