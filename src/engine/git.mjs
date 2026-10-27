// SPDX-License-Identifier: Apache-2.0
// Git as the durable, human-readable history. Writes are batched: one commit per quiet period.
import { spawnSync } from 'node:child_process';

export function git(root, args, opts = {}) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(opts.env || {}) }, input: opts.input });
  return { ok: r.status === 0, status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

export class CommitQueue {
  constructor(root, { delayMs = 400, enabled = true } = {}) { this.root = root; this.delayMs = delayMs; this.enabled = enabled; this.pending = new Map(); this.timer = null; this.commits = 0; }
  add(p, client) {
    if (!this.enabled) return;
    if (!this.pending.has(p)) this.pending.set(p, new Set());
    if (client) this.pending.get(p).add(client);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delayMs);
    this.timer.unref?.();
  }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    if (!this.pending.size) return null;
    const paths = [...this.pending.keys()]; const clients = new Set([...this.pending.values()].flatMap((s) => [...s]));
    this.pending.clear();
    git(this.root, ['add', '-A', '--', ...paths]);
    const subject = paths.length === 1 ? `memev: ${paths[0]}` : `memev: ${paths.length} notes`;
    const body = clients.size ? `\n\nMemev-Client: ${[...clients].sort().join(', ')}` : '';
    const r = git(this.root, ['commit', '-q', '-m', `${subject}${body}`]);
    if (r.ok) this.commits++;
    return r;
  }
}
