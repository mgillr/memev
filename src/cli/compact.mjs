// SPDX-License-Identifier: Apache-2.0
// `memev compact`: measure the vault from disk and, when not a dry run, archive sealed op-log
// segments and move old journal sessions out of the index. Nothing is deleted.
import { Vault } from '../engine/vault.mjs';
import { VaultLocked } from '../engine/oplog.mjs';
import { out } from './common.mjs';

const fmt = (n) => `${n} bytes`;

function printReport(o) {
  console.log(`  op-log   ${fmt(o.oplog.bytes)}  in ${o.oplog.segments} segments (${o.oplog.archived} archived, ${fmt(o.oplog.activeBytes)} active)`);
  console.log(`  journal  ${fmt(o.journal.bytes)}  in ${o.journal.files} files`);
  console.log(`  index    ${fmt(o.index.bytes)}`);
  console.log(`  git      ${fmt(o.git.bytes)}  of objects`);
}

export async function command(cmd, pos, flags, { root }) {
  // A running daemon keeps appending through its open segment file; compacting underneath it would orphan the records it writes
  // after the archive rename. The guard is the vault lock, not daemon.json: whoever holds the lock, the daemon or another command,
  // is named, and a live process that merely appears in daemon.json holds nothing.
  let v;
  try { v = new Vault(root, { git: false }).open(); }
  catch (e) {
    if (!(e instanceof VaultLocked)) throw e;
    out.bad(`VaultLocked: ${e.pid ? `pid ${e.pid} holds` : 'another process holds'} the vault, and compact needs it to itself. Stop it first (memev stop for the daemon), then run memev compact${e.pid ? '' : ' (the lock names no holder)'}.`);
    return 1;
  }
  let rep;
  try { rep = v.compact({ dryRun: !!flags['dry-run'] }); } finally { v.close(); }
  if (flags.json) { console.log(JSON.stringify(rep, null, 2)); return 0; }
  if (rep.dryRun) { console.log('Memev size report (dry run, nothing changed):'); printReport(rep.before); return 0; }
  console.log('Before:'); printReport(rep.before);
  console.log(`\nCompacted: archived ${rep.archived} op-log segment(s), moved ${rep.retained} journal file(s) to the archive.`);
  console.log('After:'); printReport(rep.after);
  return 0;
}
