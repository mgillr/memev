// MEM-070: the referral credit spec. The credit is one free month of Personal for the referrer,
// through a Stripe checkout referral code, opt-in only, with no in-app tracking and no telemetry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('MEM-070 AC01: the referral mechanism spec exists and covers how the code is issued, redeemed at checkout, what the referrer gets, and what is never collected', () => {
  const spec = read('docs/REFERRAL.md');
  assert.match(spec, /^# Referral credit/m);
  assert.match(spec, /## How the code is issued/);
  assert.match(spec, /## How it is redeemed at checkout/);
  assert.match(spec, /## What the referrer gets/);
  assert.match(spec, /## What is never collected/);
});

test('MEM-070 AC02: the spec records the decided credit, one free month of Personal for the referrer only via a Stripe checkout referral code, opt-in only, with no in-app tracking and no telemetry, and the pricing doc matches', () => {
  const spec = read('docs/REFERRAL.md');
  assert.match(spec, /one free month of Personal/);
  assert.match(spec, /referrer only/);
  assert.match(spec, /Stripe checkout referral code/);
  assert.match(spec, /opt-in/);
  assert.match(spec, /No in-app tracking/);
  assert.match(spec, /No telemetry/);
  const pricing = read('docs/PRICING.md');
  assert.match(pricing, /## Referral credit/);
  assert.match(pricing, /one free month of Personal/);
  assert.match(pricing, /no in-app\s*\n?tracking and no telemetry/);
  assert.match(pricing, /\[REFERRAL\.md\]\(REFERRAL\.md\)/);
});
