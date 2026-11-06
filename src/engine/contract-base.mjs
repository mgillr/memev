// SPDX-License-Identifier: Apache-2.0
// The base of a signed contract that records none. It is never chosen and never signed: it is derived from git history as the
// parent of the commit that first added the signed body, so anyone can repeat it. The receipt says it was derived.
import fs from 'node:fs';
import { git } from './git.mjs';
import { canonicalHash } from '../../vendor/attest/signature.mjs';

const SHA40 = /^[0-9a-f]{40}$/;

/** { sha } or { problem }, in a checkout of the repository that holds contracts/signed/<id>.json. */
export function deriveBase({ repo, id, contract }) {
  if (!repo || !fs.existsSync(repo) || !git(repo, ['rev-parse', '--git-dir']).ok) return { problem: 'no checkout of the repository that holds the signed body' };
  if (git(repo, ['rev-parse', '--is-shallow-repository']).out?.trim() === 'true') return { problem: 'the checkout is a shallow clone, so the first commit of the body cannot be found' };
  const rel = `contracts/signed/${id}.json`;
  const shown = git(repo, ['show', `HEAD:${rel}`]);
  if (!shown.ok) return { problem: `this checkout does not hold ${rel} at HEAD` };
  let held; try { held = JSON.parse(shown.out); } catch { return { problem: `${rel} in this checkout is not readable` }; }
  if (canonicalHash(held) !== canonicalHash(contract)) return { problem: `${rel} in this checkout is a different contract` };
  const added = git(repo, ['log', '--follow', '--diff-filter=A', '--format=%H', '--', rel]);
  const first = added.ok ? added.out.trim().split('\n').filter(Boolean).pop() : null;
  if (!first) return { problem: `${rel} has no commit that added it` };
  const parent = git(repo, ['rev-parse', '--verify', '--quiet', `${first}^`]);
  const sha = parent.ok ? parent.out.trim() : '';
  return SHA40.test(sha) ? { sha } : { problem: `the commit that first added ${rel} has no parent` };
}
