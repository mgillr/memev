// SPDX-License-Identifier: Apache-2.0
// An export zip is a file someone else made. Reading one must not inflate past a limit, whatever its header says.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { tmpdir, cleanup, PKG } from './helpers/tmp.mjs';
import { initVault } from '../src/engine/vault.mjs';
import { readZip } from '../src/engine/zip.mjs';
import { scanExport } from '../src/engine/importers/exports.mjs';
import { command } from '../src/cli/import.mjs';

after(cleanup);

const MIB = 1024 * 1024;
// the limit as this test holds it, so the test goes red if the constant in zip.mjs is raised past it
const LIMIT = 64 * MIB;

/** Deflate that many MiB of zeros without ever holding them all in memory. */
async function deflatedZeros(mib) {
  const out = [];
  const zeros = Buffer.alloc(MIB);
  const source = Readable.from((function* () { for (let i = 0; i < mib; i++) yield zeros; })());
  const sink = async function* (chunks) { for await (const c of chunks) out.push(c); };
  await pipeline(source, zlib.createDeflateRaw({ level: 1 }), sink);
  return Buffer.concat(out);
}

/** A zip with one local record per entry and one directory record per `refs` (more than one points them all at the same bytes). */
function zipOf(entries, { refs = 1 } = {}) {
  const parts = []; const cd = []; let offset = 0;
  for (const { name, comp, method = 8, declared } of entries) {
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(declared, 22); lh.writeUInt16LE(n.length, 26);
    for (let r = 0; r < refs; r++) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(method, 10);
      c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(declared, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
      cd.push(c, n);
    }
    parts.push(lh, n, comp);
    offset += 30 + n.length + comp.length;
  }
  const dir = Buffer.concat(cd);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length * refs, 8); end.writeUInt16LE(entries.length * refs, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

const CONVERSATION = JSON.stringify([{ role: 'user', content: 'the heron nests beside the old weir' }]);
const ordinary = () => { const data = Buffer.from(CONVERSATION); return zipOf([{ name: 'conversations.json', comp: zlib.deflateRawSync(data), declared: data.length }]); };

test('T4-c09: a zip entry that would inflate past the limit is refused before it is inflated in full, whatever its header says; an ordinary zip imports', async () => {
  const comp = await deflatedZeros(200);

  // a truthful header: the size is declared, and the entry is refused before any of it is inflated
  const truthful = zipOf([{ name: 'conversations.json', comp, declared: 200 * MIB }]);
  assert.throws(() => readZip(truthful), /too large/, 'a truthful header over the limit is refused');

  // a lying header: it declares a few bytes, so only a limit on the actual output can catch it
  const lying = zipOf([{ name: 'conversations.json', comp, declared: 16 }]);
  assert.throws(() => readZip(lying), /too large/, 'a lying header is refused on what it really inflates to');
  assert.throws(() => readZip(lying), (e) => e.code === 'zip_too_large' && /conversations\.json/.test(e.message), 'the refusal names the entry');

  // many entries under the limit that together are not: the same bytes referenced over and over
  const shared = await deflatedZeros(16);
  const manyRefs = zipOf([{ name: 'conversations.json', comp: shared, declared: 16 * MIB }], { refs: 20 });
  assert.throws(() => readZip(manyRefs), /too large/, 'the limit also holds across entries (20 x 16 MiB)');

  // an entry a little over the limit: the test holds the limit itself, so raising the constant goes red here
  const justOver = zipOf([{ name: 'conversations.json', comp: await deflatedZeros(LIMIT / MIB + 1), declared: 16 }]);
  assert.throws(() => readZip(justOver), /too large/, 'one MiB over the limit is refused');

  // the memory it costs to refuse: a child process, because only its peak says what the attempt really held
  const root = tmpdir('zip-bomb-'); const bomb = path.join(root, 'bomb.zip');
  fs.writeFileSync(bomb, lying);
  const probe = `import { readZip } from ${JSON.stringify(path.join(PKG, 'src', 'engine', 'zip.mjs'))}; import fs from 'node:fs';
    const buf = fs.readFileSync(${JSON.stringify(bomb)}); const before = process.resourceUsage().maxRSS;
    let refused = false; try { readZip(buf); } catch { refused = true; }
    console.log(JSON.stringify({ refused, grewKb: process.resourceUsage().maxRSS - before }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const { refused, grewKb } = JSON.parse(r.stdout);
  assert.equal(refused, true);
  assert.ok(grewKb * 1024 < LIMIT * 1.5, `refusing a 200 MiB entry grew the peak by ${Math.round(grewKb / 1024)} MiB`);

  // what the person sees: memev import says so and exits non-zero, instead of a preview with nothing in it
  const vault = path.join(root, 'vault');
  initVault(vault, { template: path.join(PKG, 'templates', 'vault') });
  const conf = process.env.MEMEV_CONFIG_DIR; process.env.MEMEV_CONFIG_DIR = path.join(root, 'conf');
  const seen = []; const log = console.log; const err = console.error;
  console.log = (...a) => seen.push(a.join(' ')); console.error = (...a) => seen.push(a.join(' '));
  try {
    const run = (flags) => command('import', [], flags, { root: vault, env: { ...process.env, HOME: root } });
    const rc = await run({ export: bomb, yes: true });
    assert.equal(rc, 1, `the import of a bomb is refused: ${seen.join(' | ')}`);
    assert.match(seen.join('\n'), /refused.*too large/s);

    // an ordinary zip still imports, by the same command
    const good = path.join(root, 'export.zip'); fs.writeFileSync(good, ordinary());
    seen.length = 0;
    assert.equal(await run({ export: good, yes: true }), 0, seen.join(' | '));
    assert.match(seen.join('\n'), /Imported 1 item/);
  } finally {
    console.log = log; console.error = err;
    if (conf === undefined) delete process.env.MEMEV_CONFIG_DIR; else process.env.MEMEV_CONFIG_DIR = conf;
  }

  const items = scanExport(path.join(root, 'export.zip'));
  assert.equal(items.length, 1);
  assert.match(items[0].content, /old weir/);
  assert.equal(readZip(ordinary())[0].data.toString('utf8'), CONVERSATION);
});

test('an entry reports the size it really is, so the importer\'s own size rule cannot be lied to', () => {
  const data = Buffer.alloc(600 * 1024, 'x');
  const [e] = readZip(zipOf([{ name: 'conversations.json', comp: zlib.deflateRawSync(data), declared: 16 }]));
  assert.equal(e.size, data.length);
});
