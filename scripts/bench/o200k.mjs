// SPDX-License-Identifier: Apache-2.0
// Token counter for the o200k_base encoding, with no dependency: the byte-pair ranks are the published
// o200k_base.tiktoken file, gzipped next to this file and checked against its published SHA-256 when loaded.
// count(text) gives the same number as tiktoken's encode(text) for text without special-token markers.
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const RANKS = new URL('./o200k_base.tiktoken.gz', import.meta.url);
const RANKS_SHA256 = '446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d';
// o200k_base's split pattern. JavaScript has no inline (?i:...), so the contractions spell out both cases.
const CONTRACTION = "(?:'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD])?";
const PATTERN = new RegExp([
  `[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]*[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]+${CONTRACTION}`,
  `[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]+[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]*${CONTRACTION}`,
  '\\p{N}{1,3}',
  ' ?[^\\s\\p{L}\\p{N}]+[\\r\\n/]*',
  '\\s*[\\r\\n]+',
  '\\s+(?!\\S)',
  '\\s+',
].join('|'), 'gu');

let ranks = null; // byte sequence (one char per byte) -> rank
function load() {
  const raw = zlib.gunzipSync(fs.readFileSync(RANKS));
  const sha = crypto.createHash('sha256').update(raw).digest('hex');
  if (sha !== RANKS_SHA256) throw new Error(`o200k_base ranks: sha256 ${sha} is not the published ${RANKS_SHA256}`);
  ranks = new Map();
  for (const line of raw.toString('latin1').split('\n')) {
    const sp = line.indexOf(' ');
    if (sp > 0) ranks.set(Buffer.from(line.slice(0, sp), 'base64').toString('latin1'), Number(line.slice(sp + 1)));
  }
}

// Tokens for one piece of the split: merge the adjacent pair with the lowest rank until none is left,
// the same order tiktoken merges in.
function pieceTokens(piece) {
  if (ranks.has(piece)) return 1;
  const at = []; for (let i = 0; i <= piece.length; i++) at.push(i); // part boundaries
  const pair = (i) => (i + 2 < at.length ? ranks.get(piece.slice(at[i], at[i + 2])) ?? Infinity : Infinity);
  const r = []; for (let i = 0; i < at.length - 2; i++) r.push(pair(i));
  for (;;) {
    let best = Infinity, bi = -1;
    for (let i = 0; i < r.length; i++) if (r[i] < best) { best = r[i]; bi = i; }
    if (bi < 0) break;
    at.splice(bi + 1, 1); r.splice(bi, 1);
    if (bi < r.length) r[bi] = pair(bi);
    if (bi > 0) r[bi - 1] = pair(bi - 1);
  }
  return at.length - 1;
}

export function count(text) {
  if (!ranks) load();
  const s = typeof text === 'string' ? text : JSON.stringify(text);
  let n = 0;
  for (const m of s.matchAll(PATTERN)) n += pieceTokens(Buffer.from(m[0], 'utf8').toString('latin1'));
  return n;
}
