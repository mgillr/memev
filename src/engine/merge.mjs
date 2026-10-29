// SPDX-License-Identifier: Apache-2.0
// The engine call boundary. The core hands a conflicted note to the external merge engine only
// through this file, and only when the licence allows it. The engine is a separate component under
// its own licence, not in this repository: it is reached as an external process the install
// registers here, and the core holds no convergence logic of its own. When the licence does not
// allow the engine, or the engine is not registered, refuses, or fails, both versions are kept
// whole and a line names the reason.
import { spawnSync } from 'node:child_process';
import { verifyLicense, LICENSE_KEYS } from './license.mjs';

/**
 * Whether the licence allows the merge engine to be called. A valid trial allows it while the
 * trial is current; once the trial has expired (grace or beyond) it does not. A non-trial licence
 * allows it while valid or in grace. No licence, an invalid licence, or a licence without the
 * merge service does not.
 */
export function engineAllowed(license, { now = Date.now(), keys = LICENSE_KEYS } = {}) {
  if (!license) return false;
  const v = verifyLicense(license, { keys, now });
  if (v.state !== 'valid' && v.state !== 'grace') return false;
  if (!v.services || !v.services.includes('merge')) return false;
  if (license.trial === true && v.state !== 'valid') return false;
  return true;
}

/**
 * The registration point: the engine registers itself here, not the reverse. The core never
 * imports the engine; the install hands the boundary a provider (an in-process function, or a
 * command the boundary runs as an external process) and the boundary calls it.
 */
export function registerMergeProvider(provider) {
  globalThis.__memevMergeProvider = provider;
}

/**
 * A provider that reaches the engine as an external process. The boundary sends the two versions
 * and the base to the command's standard input as one JSON line, and reads one JSON line back:
 * `{ "text": "..." }` is the merged note, `{ "refuse": true }` keeps both versions. The command
 * is not a package dependency of this repository: it is a program the install points at, and
 * nothing in this repository imports it.
 */
export function commandProvider(command, { args = [], timeoutMs = 30000 } = {}) {
  return {
    kind: 'command',
    resolve({ a, b, base }) {
      const input = JSON.stringify({ a, b, base: base ?? null });
      const r = spawnSync(command, args, { input, encoding: 'utf8', timeout: timeoutMs });
      if (r.error || r.status !== 0) {
        throw new Error(r.error ? r.error.message : (r.stderr || '').trim() || `exit ${r.status}`);
      }
      const line = String(r.stdout).split('\n').map((l) => l.trim()).find(Boolean);
      if (!line) throw new Error('no answer');
      const out = JSON.parse(line);
      if (out && out.refuse) return { refuse: true };
      if (!out || typeof out.text !== 'string') throw new Error('no merged text in the answer');
      return { text: out.text };
    },
  };
}

/**
 * Call the merge engine for one conflicted note, or keep both versions. The provider is the
 * install's stand-in for the engine: it receives only the two versions and the base, and returns
 * the merged text. When the licence does not allow the engine, or the provider is missing,
 * refuses, or fails, both versions are kept and a line names the reason.
 */
export function resolveMerge({ a, b, base = null, license = null, config = null, now = Date.now(), keys = LICENSE_KEYS, log = () => {} }) {
  if (!engineAllowed(license, { now, keys })) {
    log('kept both versions: the licence does not allow the merge engine');
    return { resolved: false, keepBoth: true, reason: 'the licence does not allow the merge engine' };
  }
  const provider = config?.merge?.provider ?? globalThis.__memevMergeProvider ?? null;
  if (!provider || typeof provider.resolve !== 'function') {
    log('kept both versions: no merge provider is installed');
    return { resolved: false, keepBoth: true, reason: 'no merge provider is installed' };
  }
  try {
    const r = provider.resolve({ a, b, base });
    if (r && typeof r.text === 'string') {
      return { resolved: true, keepBoth: false, text: r.text };
    }
    log('kept both versions: the merge engine refused');
    return { resolved: false, keepBoth: true, reason: 'the merge engine refused' };
  } catch (e) {
    log(`kept both versions: the merge engine failed: ${e.message}`);
    return { resolved: false, keepBoth: true, reason: `the merge engine failed: ${e.message}` };
  }
}
