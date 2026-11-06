// SPDX-License-Identifier: Apache-2.0
// What the running daemon measured about itself, for `memev status --json`. Counted since this start, kept in memory, never estimated:
// a figure with nothing behind it yet is null, and not_measured names what this process cannot see at all.
const RECALLS = 256;

export class Health {
  constructor() { this.startMs = null; this.times = new Float64Array(RECALLS); this.recalls = 0; this.longestSave = null; this.given = 0; this.none = 0; }
  opened(ms) { this.startMs = Math.round(ms); }
  recall(ms) { this.times[this.recalls++ % RECALLS] = ms; }
  saveBlock(ms) { if (this.longestSave === null || ms > this.longestSave) this.longestSave = ms; }
  /** A prompt the hook asked about: did it get any memory? */
  prompt(given) { if (given) this.given++; else this.none++; }
  report(mu = process.memoryUsage()) {
    const sorted = this.times.slice(0, Math.min(this.recalls, RECALLS)).sort(); const at = (q) => (sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] * 10) / 10 : null);
    return {
      start_ms: this.startMs,
      recall: { count: this.recalls, window: sorted.length, p50_ms: at(0.5), p95_ms: at(0.95) },
      longest_save_block_ms: this.longestSave === null ? null : Math.round(this.longestSave * 10) / 10,
      memory: { rss_mb: Math.round(mu.rss / 1048576), heap_mb: Math.round(mu.heapUsed / 1048576) },
      prompts: { with_memory: this.given, without_memory: this.none, skipped_for_time: null },
      // the hook gives up on the client's side when its time budget runs out, and the daemon is never told
      not_measured: ['prompts.skipped_for_time'],
    };
  }
}
