// SPDX-License-Identifier: Apache-2.0
// The losing and control configurations of the bus search, rebuilt from the old bus so their numbers can be reproduced:
//   node scripts/bench/speed/lab/bus-variants.mjs <out-dir>
// then pass the files to scripts/bench/speed/bus.mjs with --impl. Nothing in the product imports these.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..');
const main = fs.readFileSync(path.join(REPO, 'test/fixtures/bus-main-oracle.mjs'), 'utf8')
  .replace(/from '\.\.\/\.\.\/src\/engine\/([a-z0-9-]+\.mjs)'/g, (_, m) => `from '${pathToFileURL(path.join(REPO, 'src/engine', m)).href}'`);
const patch = (s, pairs) => { for (const [a, b] of pairs) { if (!s.includes(a)) throw new Error(`missing: ${a.slice(0, 60)}`); s = s.replace(a, () => b); } return s; };

const MEMO = [[`  all() {
    const out = []; for (const f of this._logFiles()) out.push(...this._readLog(f));
    out.sort(order);
    return out.map((m, i) => ({ seq: i + 1, ...m }));
  }`, `  all() {
    const files = this._logFiles(); const key = files.map((f) => { const st = fs.statSync(this._p('log', f)); return f + st.size + st.mtimeMs; }).join();
    if (this._memo?.key === key) return this._memo.out;
    const out = []; for (const f of files) out.push(...this._readLog(f));
    out.sort(order);
    this._memo = { key, out: out.map((m, i) => ({ seq: i + 1, ...m })) };
    return this._memo.out;
  }`]];
const current = fs.readFileSync(path.join(REPO, 'src/engine/bus.mjs'), 'utf8')
  .replace(/from '\.\/([a-z0-9-]+\.mjs)'/g, (_, m) => `from '${pathToFileURL(path.join(REPO, 'src/engine', m)).href}'`);
const CACHED = `  _cachedJson(f, fallback) {
    let st; try { st = fs.statSync(f); } catch { return fallback; }
    const c = (this._jsonCache ||= new Map()).get(f);
    if (c && c.ino === st.ino && c.size === st.size && c.mtimeMs === st.mtimeMs) return JSON.parse(JSON.stringify(c.v));
    const v = readJson(f, fallback); this._jsonCache.set(f, { ino: st.ino, size: st.size, mtimeMs: st.mtimeMs, v });
    return JSON.parse(JSON.stringify(v));
  }
`;
const variants = {
  // L3-C3, on the current code: seat and pulse files remembered until their identity, size or time changes
  'l3c3-seat-file-cache': patch(current, [
    [`  seat(name) {
    const rec = readJson(this._p('seats', \`\${fileOf(name)}.json\`), null);`, `${CACHED}  seat(name) {
    const rec = this._cachedJson(this._p('seats', \`\${fileOf(name)}.json\`), null);`],
    [`.map((x) => readJson(this._p('seats', x), null))`, `.map((x) => this._cachedJson(this._p('seats', x), null))`],
    [`_pulse(seat) { return readJson(this._p('pulse', \`\${fileOf(seat)}.json\`), { seat, read: {} }); }`, `_pulse(seat) { return this._cachedJson(this._p('pulse', \`\${fileOf(seat)}.json\`), { seat, read: {} }); }`],
  ]),
  // L1-C1, the known method alone: remember the sorted array, keep every per-seat scan
  'l1c1-memo-only': patch(main, MEMO),
  // L1-C5, the arXiv pass's stack distance idea: scan back from the end until every seat has been seen; claims still need one pass
  'l1c5-stack-distance': patch(main, [...MEMO, [`    const rows = this.seats().map((s) => {`, `    const seen = this.seats(); const want = new Set(seen.flatMap((s) => [s.seat, ...(s.renamed_from || [])])); const lastBy = new Map(); const statusBy = new Map();
    for (let i = all.length - 1; i >= 0 && (lastBy.size < want.size || statusBy.size < want.size); i--) { const m = all[i]; if (!lastBy.has(m.from)) lastBy.set(m.from, m); if (m.type === 'status' && !m.check && !statusBy.has(m.from)) statusBy.set(m.from, m); }
    const verdicts = new Set(); const claimsBy = new Map(); for (const m of all) { if (m.type === 'verdict') verdicts.add(m.ref); else if (m.type === 'claim') { if (!claimsBy.has(m.from)) claimsBy.set(m.from, []); claimsBy.get(m.from).push(m); } }
    const rows = seen.map((s) => {`],
  [`const last = all.filter((m) => names.includes(m.from)).at(-1);`, `const last = names.map((n) => lastBy.get(n)).filter(Boolean).sort((a, b) => a.seq - b.seq).at(-1);`],
  [`const claims = all.filter((m) => m.type === 'claim' && names.includes(m.from) && !all.some((v) => v.type === 'verdict' && v.ref === m.ref)).map((m) => m.ref);`, `const claims = names.flatMap((n) => claimsBy.get(n) || []).filter((m) => !verdicts.has(m.ref)).map((m) => m.ref);`],
  [`const status = all.filter((m) => m.type === 'status' && names.includes(m.from) && !m.check).at(-1);`, `const status = names.map((n) => statusBy.get(n)).filter(Boolean).sort((a, b) => a.seq - b.seq).at(-1);`]]),
};
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
for (const [name, text] of Object.entries(variants)) fs.writeFileSync(path.join(out, `${name}.mjs`), text);
console.log(Object.keys(variants).join('\n'));
