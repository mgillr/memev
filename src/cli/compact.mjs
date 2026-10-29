// SPDX-License-Identifier: Apache-2.0
// `memev compact`: measure the vault from disk and, when not a dry run, archive sealed op-log
// segments and move old journal sessions out of the index. Nothing is deleted.
import { Vault } from '../engine/vault.mjs';
import { daemonInfo, pidAlive, out } from './common.mjs';

const fmt = (n) => `${n} bytes`;

function printReport(o) {
  console.log(`  op-log   ${fmt(o.oplog.bytes)}  in ${o.oplog.segments} segments (${o.oplog.archived} archived, ${fmt(o.oplog.activeBytes)} active)`);
  console.log(`  journal  ${fmt(o.journal.bytes)}  in ${o.journal.files} files`);
  console.log(`  index    ${fmt(o.index.bytes)}`);
  console.log(`  git      ${fmt(o.git.bytes)}  of objects`);
}

export async function command(cmd, pos, flags, { root }) {
  // A running daemon keeps appending through its open segment file; compacting underneath it would
  // orphan the records it writes after the archive rename, so compact works on a stopped vault only.
  const info = daemonInfo(root);
  if (info && pidAlive(info.pid)) {
    out.bad('Memev is running for this vault, and compact works on a stopped vault. Run memev stop, then memev compact, then memev start.');
    return 1;
  }
  const v = new Vault(root, { git: false }).open();
  const rep = v.compact({ dryRun: !!flags['dry-run'] });
  v.close();
  if (flags.json) { console.log(JSON.stringify(rep, null, 2)); return 0; }
  if (rep.dryRun) { console.log('Memev size report (dry run, nothing changed):'); printReport(rep.before); return 0; }
  console.log('Before:'); printReport(rep.before);
  console.log(`\nCompacted: archived ${rep.archived} op-log segment(s), moved ${rep.retained} journal file(s) to the archive.`);
  console.log('After:'); printReport(rep.after);
  return 0;
}
