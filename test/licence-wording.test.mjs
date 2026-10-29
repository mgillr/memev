// SPDX-License-Identifier: Apache-2.0
// The public docs, templates and source describe the licence by what each plan includes. They do
// not describe ways round the computer limit. This keeps that wording from coming back in a later
// edit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRIAL_DAYS, TRIAL_EXT_DAYS, TRIAL_DEFAULTS } from './helpers/trial-constants.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = (d, ext) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name), ext) : ext.some((x) => e.name.endsWith(x)) ? [path.join(d, e.name)] : []));
const FILES = ['README.md', 'CHARTER.md', 'SECURITY.md', 'NOTICE', ...walk('docs', ['.md']), ...walk('templates', ['.md']),
  ...walk('src', ['.mjs']), ...walk('bin', ['.mjs']), ...walk('scripts/license', ['.mjs']), 'scripts/license-dev.mjs'];
const BANNED = [
  /patch(?:ed)?\s+(?:\w+\s+){0,3}out/i,
  /\b(?:bypass|circumvent)/i,
  /\bget(?:s|ting)?\s+(?:past|around|round)\b/i,
  /\b(?:fake[ds]?|faking|spoof\w*)\s+(?:a\s+)?(?:cloud|user.agent)/i,
  /\bport\s+forward/i,
  /\b(?:honest|known)\s+(?:gap|limit)/i,
  /licensing\s+honest/i,
  /\bnot\s+DRM\b/i,
  /\bnothing\s+is\s+enforced\b/i,
];

test('public text carries no directions for getting round the computer limit', () => {
  const found = [];
  for (const f of FILES) {
    fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
      for (const re of BANNED) if (re.test(line)) found.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(found, []);
});

test('the licence terms stay stated: Free needs no licence, the plan sets the computers, grace then read-only', () => {
  const pricing = fs.readFileSync(path.join(ROOT, 'docs/PRICING.md'), 'utf8');
  assert.match(pricing, /\*\*Free:\*\* one computer, no licence/);
  assert.match(pricing, /the plan sets how many computers can join/);
  assert.match(pricing, /grace period \(14 days unless the licence says otherwise\)/);
  assert.match(pricing, /can read but not write/);
});

const readDoc = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const CHANGED = ['docs/BUSINESS-TRIAL.md', 'docs/LICENSING-NOTICE.md', 'docs/PRICING.md', 'docs/deploy-cloud.md',
  'docs/deploy-on-prem.md', 'docs/tiers/README.md', 'docs/tiers/business.md', 'docs/tiers/corporate.md',
  'changelog.d/MEM-135.md'];

test('MEM-135 AC01: the pricing page says there is no Personal trial and Business has a time-limited trial, with no price added', () => {
  const pricing = readDoc('docs/PRICING.md');
  assert.match(pricing, /no Personal trial/i);
  assert.match(pricing, /time-limited trial/i);
  const row = pricing.split('\n').find((l) => l.startsWith('| Trial |'));
  const cells = row.split('|').slice(1, -1).map((c) => c.trim());
  assert.equal(cells[0], 'Trial');
  assert.match(cells[1], /no Personal trial/i);
  assert.match(cells[2], /no Personal trial/i);
  assert.match(cells[3], /time-limited trial/i);
  assert.match(cells[3], /planned/i);
  assert.match(cells[4], /sales-assisted pilot/i);
  const price = pricing.split('\n').find((l) => l.startsWith('| Price |'));
  assert.match(price, /contact us \| contact us/);
});

test('MEM-135 AC02: the trial page states the length, the size, the two paths, the cost model, the end-of-trial order, the extension, conversion, one trial per organisation, personal separation, built vs planned, and the deploy links', () => {
  const t = readDoc('docs/BUSINESS-TRIAL.md');
  assert.match(t, new RegExp(`\\b${TRIAL_DAYS} days\\b`));
  assert.match(t, new RegExp(`once by ${TRIAL_EXT_DAYS} days`));
  assert.match(t, new RegExp(`\\b${TRIAL_DAYS + TRIAL_EXT_DAYS} days\\b`));
  assert.match(t, new RegExp(`\\b${TRIAL_DEFAULTS.members} members\\b`));
  assert.match(t, new RegExp(`\\b${TRIAL_DEFAULTS.computers} computers\\b`));
  assert.match(t, /Self-serve Business trial/i);
  assert.match(t, /sales-assisted pilot/i);
  assert.match(t, /hosted AI providers/i);
  assert.match(t, /cloud-hosted/i);
  assert.match(t, /internal model/i);
  assert.match(t, /air-gapped/i);
  assert.match(t, /compliance-led/i);
  assert.match(t, /order form/i);
  assert.match(t, /licence is installed/i);
  assert.match(t, /\]\(deploy-cloud\.md\)/);
  assert.match(t, /\]\(deploy-on-prem\.md\)/);
  assert.match(t, /\]\(DOCKER\.md\)/);
  assert.match(t, /docs\/SETUP-SESSION\.md/);
  assert.match(t, /docs\/CLOUD-TRIAL\.md/);
  assert.match(t, /trial entitlement is free/i);
  assert.match(t, /cloud-hosted trial is free and provisioned self-serve/i);
  assert.match(t, /container image is free/i);
  assert.match(t, /operator on-prem is a paid service/i);
  assert.match(t, /\]\(tiers\/services\.md\)/);
  assert.match(t, /full merge engine is on/i);
  const order = ['grace period', 'the merge is off', 'read-only', 'Nothing is deleted', 'Export always works'];
  let last = -1;
  for (const step of order) {
    const i = t.indexOf(step);
    assert.ok(i > last, `end-of-trial step out of order or missing: ${step}`);
    last = i;
  }
  assert.match(t, /verified work contact/i);
  assert.match(t, /never granted a\s+second time/i);
  assert.match(t, /## Converting/);
  assert.match(t, /One trial per organisation/i);
  assert.match(t, /personal or home vault never crosses/i);
  assert.match(t, /## What is built and what is planned/);
});

test('MEM-135 AC03: the licensing notice says the trial is a time-limited entitlement to call a separately licensed engine, whose source and licence are not in this repository and which is not part of the free core, and names no patent or outside licence', () => {
  const n = readDoc('docs/LICENSING-NOTICE.md');
  assert.match(n, /time-limited entitlement/i);
  assert.match(n, /separately licensed/i);
  assert.match(n, /not part of this repository/i);
  assert.match(n, /not part of the\s+free core/i);
  assert.doesNotMatch(n, /patent/i);
});

test('MEM-135 AC04: the changed docs make no claim of approval or accreditation by an outside body, carry no em-dash, and keep the planned label on the hosted trial paths', () => {
  for (const f of CHANGED) {
    const text = readDoc(f);
    assert.doesNotMatch(text, /\b(?:certified|accredit\w*|approved by|endorsed by|certification)\b/i, f);
    assert.doesNotMatch(text, /\u2014/, f);
  }
  const t = readDoc('docs/BUSINESS-TRIAL.md');
  assert.match(t, /Self-serve Business trial \(planned\)/i);
  assert.match(t, /Sales-assisted pilot \(planned\)/i);
  const status = readDoc('docs/tiers/README.md');
  const row = status.split('\n').find((l) => l.startsWith('| Business trial:'));
  assert.match(row, /\| planned \|/);
});

test('MEM-135 AC05: the trial length and size stated in the changed docs match TRIAL_DAYS, TRIAL_EXT_DAYS and TRIAL_DEFAULTS', () => {
  const days = new Set([TRIAL_DAYS, TRIAL_EXT_DAYS, TRIAL_DAYS + TRIAL_EXT_DAYS]);
  const sizes = new Set([TRIAL_DEFAULTS.members, TRIAL_DEFAULTS.computers]);
  const bad = [];
  for (const f of CHANGED) {
    readDoc(f).split('\n').forEach((line, i) => {
      if (!/trial/i.test(line)) return;
      for (const m of line.matchAll(/\b(\d+)\s*-?\s*days?\b/g)) if (!days.has(Number(m[1]))) bad.push(`${f}:${i + 1}: ${m[0]} (days)`);
      for (const m of line.matchAll(/\b(\d+)\s*(?:members|computers)\b/g)) if (!sizes.has(Number(m[1]))) bad.push(`${f}:${i + 1}: ${m[0]} (size)`);
    });
  }
  assert.deepEqual(bad, []);
});

test('MEM-135 AC06: the changed docs read in the house style, with no hype words and no exclamation marks', () => {
  for (const f of CHANGED) {
    const text = readDoc(f);
    assert.doesNotMatch(text, /\b(?:seamless|robust|powerful|leverage|unlock|cutting-?edge)\b/i, f);
    assert.doesNotMatch(text, /not just .*but/i, f);
    assert.doesNotMatch(text, /!/, f);
  }
});
