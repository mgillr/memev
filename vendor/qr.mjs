// SPDX-License-Identifier: Apache-2.0
// A byte-mode QR symbol, error correction L, versions 1 to 9, 11 and 13 (the two larger ones have equal
// blocks). Enough for an invite link or a WhatsApp link code.
// The mask is 0. Version 7 and above carry the version information bits.

const SPEC = {
  1: { data: 19, ecc: 7, blocks: 1, align: [] },
  2: { data: 34, ecc: 10, blocks: 1, align: [6, 18] },
  3: { data: 55, ecc: 15, blocks: 1, align: [6, 22] },
  4: { data: 80, ecc: 20, blocks: 1, align: [6, 26] },
  5: { data: 108, ecc: 26, blocks: 1, align: [6, 30] },
  6: { data: 136, ecc: 18, blocks: 2, align: [6, 34] },
  7: { data: 156, ecc: 20, blocks: 2, align: [6, 22, 38] },
  8: { data: 194, ecc: 24, blocks: 2, align: [6, 24, 42] },
  9: { data: 232, ecc: 30, blocks: 2, align: [6, 26, 46] },
  11: { data: 324, ecc: 20, blocks: 4, align: [6, 30, 54] },
  13: { data: 428, ecc: 26, blocks: 4, align: [6, 34, 62] },
};
const VERSIONS = Object.keys(SPEC).map(Number).sort((a, b) => a - b);
// byte mode counts its length in 8 bits up to version 9 and in 16 bits from version 10
const countBits = (version) => (version >= 10 ? 16 : 8);

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function rsGenerator(nsym) {
  let poly = [1];
  for (let i = 0; i < nsym; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) { next[j] ^= poly[j]; next[j + 1] ^= mul(poly[j], EXP[i]); }
    poly = next;
  }
  return poly;
}
const GENS = new Map();
function rsRemainder(data, nsym) {
  let gen = GENS.get(nsym);
  if (!gen) { gen = rsGenerator(nsym); GENS.set(nsym, gen); }
  const res = new Uint8Array(nsym);
  for (const b of data) {
    const factor = b ^ res[0];
    for (let i = 0; i < nsym - 1; i++) res[i] = res[i + 1] ^ (factor ? mul(gen[i + 1], factor) : 0);
    res[nsym - 1] = factor ? mul(gen[nsym], factor) : 0;
  }
  return res;
}

function bytesOf(text) { return Buffer.from(String(text), 'utf8'); }

function dataCodewords(payload, count, version = 1) {
  const bits = [];
  const push = (value, n) => { for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(0b0100, 4);
  push(payload.length, countBits(version));
  for (const b of payload) push(b, 8);
  const cap = count * 8;
  if (bits.length > cap) throw new Error('the invite link is too long for a QR code');
  const term = Math.min(4, cap - bits.length);
  for (let i = 0; i < term; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((n, bit) => (n << 1) | bit, 0));
  for (let pad = 0; out.length < count; pad++) out.push(pad % 2 ? 0x11 : 0xec);
  return out;
}

function codewords(payload, spec, version) {
  const data = dataCodewords(payload, spec.data, version);
  const size = spec.data / spec.blocks;
  const blocks = [];
  const eccs = [];
  for (let i = 0; i < spec.blocks; i++) {
    const block = data.slice(i * size, (i + 1) * size);
    blocks.push(block);
    eccs.push(rsRemainder(Uint8Array.from(block), spec.ecc));
  }
  const out = [];
  for (let i = 0; i < size; i++) for (const b of blocks) out.push(b[i]);
  for (let i = 0; i < spec.ecc; i++) for (const e of eccs) out.push(e[i]);
  return out;
}

function formatBits(mask = 0) {
  const data = (1 << 3) | mask; // error correction L is 01
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0b10100110111 << (i - 10);
  return (((data << 10) | (rem & 0x3ff)) ^ 0b101010000010010) & 0x7fff;
}

function versionBits(version) {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) if ((rem >>> i) & 1) rem ^= 0b1111100100101 << (i - 12);
  return ((version << 12) | (rem & 0xfff)) & 0x3ffff;
}

function blank(n) {
  const mod = Array.from({ length: n }, () => Array(n).fill(false));
  const res = Array.from({ length: n }, () => Array(n).fill(false));
  return { mod, res };
}

function markFinder(mod, res, r0, c0) {
  const n = mod.length;
  for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
    const rr = r0 + r; const cc = c0 + c;
    if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
    const on = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
    mod[rr][cc] = on; res[rr][cc] = true;
  }
}

function markAlign(mod, res, cx, cy) {
  if (res[cy][cx]) return;
  for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) {
    mod[cy + r][cx + c] = Math.max(Math.abs(r), Math.abs(c)) !== 1;
    res[cy + r][cx + c] = true;
  }
}

function reserveFormat(res) {
  const n = res.length;
  for (let i = 0; i <= 8; i++) { if (i !== 6) { res[8][i] = true; res[i][8] = true; } }
  for (let i = 0; i < 8; i++) { res[8][n - 1 - i] = true; res[n - 1 - i][8] = true; }
  res[n - 8][8] = true;
}

function drawFormat(mod, bits) {
  const n = mod.length;
  const bit = (i) => ((bits >>> (14 - i)) & 1) === 1;
  const seq = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  const seq2 = [];
  for (let i = 0; i < 7; i++) seq2.push([n - 1 - i, 8]);
  for (let i = 0; i < 8; i++) seq2.push([8, n - 8 + i]);
  for (let i = 0; i < 15; i++) { mod[seq[i][0]][seq[i][1]] = bit(i); mod[seq2[i][0]][seq2[i][1]] = bit(i); }
  mod[n - 8][8] = true;
}

function drawVersion(mod, res, version) {
  if (version < 7) return;
  const bits = versionBits(version);
  const n = mod.length;
  for (let i = 0; i < 18; i++) {
    const on = ((bits >>> i) & 1) === 1;
    const a = Math.floor(i / 3); const b = i % 3;
    mod[a][n - 11 + b] = on; res[a][n - 11 + b] = true;
    mod[n - 11 + b][a] = on; res[n - 11 + b][a] = true;
  }
}

function placeData(mod, res, words, version) {
  const bits = [];
  for (const w of words) for (let i = 7; i >= 0; i--) bits.push((w >>> i) & 1);
  const extra = version === 1 ? 0 : 7;
  for (let i = 0; i < extra; i++) bits.push(0);
  const n = mod.length;
  let i = 0; let up = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let step = 0; step < n; step++) {
      const row = up ? n - 1 - step : step;
      for (const c of [col, col - 1]) {
        if (res[row][c]) continue;
        let bit = i < bits.length ? bits[i++] : 0;
        if (((row + c) & 1) === 0) bit ^= 1; // mask 0
        mod[row][c] = bit === 1;
      }
    }
    up = !up;
  }
}

/** A boolean matrix, true for a dark module, including no quiet zone. */
export function qrMatrix(text) {
  const payload = bytesOf(text);
  let version = 0; let spec = null;
  for (const v of VERSIONS) {
    const overhead = 4 + countBits(v);
    if ((SPEC[v].data * 8) >= overhead + payload.length * 8) { version = v; spec = SPEC[v]; break; }
  }
  if (!version) throw new Error('the invite link is too long for a QR code');
  const n = 17 + 4 * version;
  const { mod, res } = blank(n);
  markFinder(mod, res, 0, 0);
  markFinder(mod, res, 0, n - 7);
  markFinder(mod, res, n - 7, 0);
  const pos = spec.align;
  for (const y of pos) for (const x of pos) if (!res[y][x]) markAlign(mod, res, x, y);
  for (let i = 0; i < n; i++) {
    if (!res[6][i]) { mod[6][i] = i % 2 === 0; res[6][i] = true; }
    if (!res[i][6]) { mod[i][6] = i % 2 === 0; res[i][6] = true; }
  }
  reserveFormat(res);
  drawVersion(mod, res, version);
  placeData(mod, res, codewords(payload, spec, version), version);
  drawFormat(mod, formatBits(0));
  return mod;
}

/** Two rows per line, so a terminal can show the symbol. */
export function qrText(text) {
  const m = qrMatrix(text);
  const n = m.length;
  const quiet = 2;
  const lines = [];
  for (let y = -quiet; y < n + quiet; y += 2) {
    let line = '';
    for (let x = -quiet; x < n + quiet; x++) {
      const top = y >= 0 && y < n && x >= 0 && x < n && m[y][x];
      const bot = y + 1 >= 0 && y + 1 < n && x >= 0 && x < n && m[y + 1][x];
      line += top && bot ? '\u2588' : top ? '\u2580' : bot ? '\u2584' : ' ';
    }
    lines.push(line);
  }
  return lines.join('\n');
}
