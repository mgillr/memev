// SPDX-License-Identifier: Apache-2.0
// Git as the durable, human-readable history. Writes are batched: one commit per quiet period.
import { run } from './util.mjs';

export function git(root, args, opts = {}) {
  const r = run('git', args, { cwd: root, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(opts.env || {}) }, input: opts.input });
  return { ok: r.ok, status: r.status, out: r.stdout.trim(), err: r.stderr.trim() || r.error || '' };
}

// git init -b main needs git 2.28; on older git, fall back to a plain init and move HEAD by hand.
export function gitInitMain(root) {
  let r = git(root, ['init', '-q', '-b', 'main']);
  if (r.ok) return r;
  r = git(root, ['init', '-q']);
  if (!r.ok) return r;
  return git(root, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
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
    const a = git(this.root, ['add', '-A', '--', ...paths]);
    if (!a.ok) return a;
    const subject = paths.length === 1 ? `memev: ${paths[0]}` : `memev: ${paths.length} notes`;
    const body = clients.size ? `\n\nMemev-Client: ${[...clients].sort().join(', ')}` : '';
    const r = git(this.root, ['commit', '-q', '-m', `${subject}${body}`]);
    // keep the paths pending on failure so the next flush retries them; only a committed flush drops them
    if (r.ok) { this.pending.clear(); this.commits++; }
    return r;
  }
}
