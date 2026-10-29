// SPDX-License-Identifier: Apache-2.0
// The engine call gate. The external merge engine is called only through a provider the install
// supplies, and only when the licence allows it. Otherwise both versions are kept whole and a line
// names the reason. The engine itself is a separate component under its own licence, not in this
// repository; this file holds only the gate.
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
  const provider = config?.merge?.provider ?? null;
  if (!provider || typeof provider.resolve !== 'function') {
    log('kept both versions: no merge provider is installed');
    return { resolved: false, keepBoth: true, reason: 'no merge provider is installed' };
  }
  try {
    const r = provider.resolve({ a, b, base });
    if (r && typeof r.text === 'string') {
      return { resolved: true, keepBoth: false, text: r.text };
    }
    log('kept both versions: the merge provider refused');
    return { resolved: false, keepBoth: true, reason: 'the merge provider refused' };
  } catch (e) {
    log(`kept both versions: the merge provider failed: ${e.message}`);
    return { resolved: false, keepBoth: true, reason: `the merge provider failed: ${e.message}` };
  }
}
