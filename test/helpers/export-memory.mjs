// SPDX-License-Identifier: Apache-2.0
// Run as: node --expose-gc test/helpers/export-memory.mjs <export.zip> <maxItemBytes>
// Reads every conversation of the export through exportConversations and prints, as JSON, the counts and the largest
// growth of live memory (JS heap plus buffers) over the start, measured after a forced collection at each sample, so a
// collector that has not run yet never counts as memory held.
import { exportConversations } from '../../src/engine/importers/history.mjs';

const [file, max] = process.argv.slice(2);
const live = () => { global.gc(); const m = process.memoryUsage(); return m.heapUsed + m.arrayBuffers; };
const base = live();
let count = 0, skipped = 0, peak = 0;
for await (const r of exportConversations(file, { maxItemBytes: Number(max) })) {
  if (r.skip) skipped++; else count++;
  if ((count + skipped) % 250 === 0) peak = Math.max(peak, live() - base);
}
peak = Math.max(peak, live() - base);
process.stdout.write(JSON.stringify({ count, skipped, peak }) + '\n');
