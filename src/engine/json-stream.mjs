// SPDX-License-Identifier: Apache-2.0
// Stream the elements of a top-level JSON array, one at a time, from a byte stream. Chat exports keep every
// conversation in one array (conversations.json), often hundreds of MB: only the element being read is held in
// memory, and an element over maxItemBytes is passed over without being kept, reported by its size.
// The scanner works on bytes: every structural character is ASCII, so a multi-byte character split between two
// chunks is never misread, and each element is decoded once it is whole.

const WS = new Set([0x20, 0x09, 0x0a, 0x0d]);

export class NotAnArray extends Error { constructor(first) { super('the JSON text is not an array'); this.code = 'not_array'; this.first = first; } }

/**
 * Yields { value, bytes } for each element, { tooLarge: true, bytes } for one over maxItemBytes, and { bad: true, bytes }
 * for one that does not parse. Throws NotAnArray when the text does not start with '[', and a SyntaxError when it ends early.
 */
export async function* jsonArrayItems(stream, { maxItemBytes = 64 * 1024 * 1024 } = {}) {
  let started = false, done = false, bom = 0;
  let depth = 0, inStr = false, esc = false;
  let parts = null, bytes = 0, dropping = false, primitive = false, partStart = 0;
  const finish = () => {
    let out;
    if (dropping) out = { tooLarge: true, bytes };
    else { try { out = { value: JSON.parse(Buffer.concat(parts).toString('utf8')), bytes }; } catch { out = { bad: true, bytes }; } }
    parts = null; bytes = 0; dropping = false; primitive = false;
    return out;
  };
  for await (let chunk of stream) {
    if (done) continue; // drain, so the source closes cleanly
    if (typeof chunk === 'string') chunk = Buffer.from(chunk);
    let i = 0;
    const out = [];
    partStart = i;
    for (; i < chunk.length; i++) {
      const c = chunk[i];
      if (!started) {
        if (WS.has(c)) continue;
        if (bom < 3 && c === [0xef, 0xbb, 0xbf][bom]) { bom++; continue; } // a byte order mark, which may span chunks
        if (c !== 0x5b) throw new NotAnArray(String.fromCharCode(c));
        started = true; partStart = i + 1; continue;
      }
      if (parts === null) {
        // between elements
        if (WS.has(c) || c === 0x2c) continue;
        if (c === 0x5d) { done = true; break; }
        parts = []; bytes = 0; partStart = i; depth = 0; inStr = false; esc = false;
        if (c === 0x7b || c === 0x5b) { depth = 1; continue; }
        if (c === 0x22) { inStr = true; primitive = true; continue; }
        primitive = true; continue;
      }
      if (inStr) {
        if (esc) esc = false;
        else if (c === 0x5c) esc = true;
        else if (c === 0x22) {
          inStr = false;
          if (primitive && depth === 0) { take(chunk, partStart, i + 1); out.push(finish()); }
        }
        continue;
      }
      if (primitive && depth === 0) {
        // a number, true, false or null ends at a comma, a close bracket or white space
        if (c === 0x2c || c === 0x5d || WS.has(c)) {
          take(chunk, partStart, i); out.push(finish());
          if (c === 0x5d) { done = true; break; }
        }
        continue;
      }
      if (c === 0x22) inStr = true;
      else if (c === 0x7b || c === 0x5b) depth++;
      else if (c === 0x7d || c === 0x5d) {
        depth--;
        if (depth === 0) { take(chunk, partStart, i + 1); out.push(finish()); }
      }
    }
    if (parts !== null && !done) take(chunk, partStart, chunk.length);
    for (const o of out) yield o;
  }
  if (!started) throw new NotAnArray('');
  if (parts !== null || !done) throw new SyntaxError('the JSON array ends early');

  function take(chunk, from, to) {
    if (to <= from) return;
    bytes += to - from;
    if (dropping) return;
    if (bytes > maxItemBytes) { dropping = true; parts = []; return; }
    // a copy, so the chunk the stream handed over can be released
    parts.push(Buffer.from(chunk.subarray(from, to)));
  }
}
