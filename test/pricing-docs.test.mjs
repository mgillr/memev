// Team, Office, Business and Enterprise are priced on request. Keep list prices for them out of
// the docs so a stale figure can't come back in a later edit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const priceRow = (md) => md.split('\n').find((l) => /^\| Price( \(draft\))? \|/.test(l));

test('quoted tiers show no list price in the tier tables', () => {
  const pricing = priceRow(read('docs/PRICING.md')).split('|').map((c) => c.trim()).filter(Boolean);
  // columns: label, Free, Personal, Team, Office, Business, Enterprise
  for (const cell of pricing.slice(3)) {
    assert.match(cell, /^contact us for a quote/, cell);
    assert.doesNotMatch(cell.replace(/\$2,500 remote setup/, ''), /\$\d/, cell);
  }
  for (const doc of ['README.md', 'docs/tiers/README.md']) {
    const cells = priceRow(read(doc)).split('|').map((c) => c.trim()).filter(Boolean).slice(2);
    for (const cell of cells) assert.match(cell, /^contact us for a quote/, `${doc}: ${cell}`);
  }
});

test('the 20-computer example has no subscription total', () => {
  const sme = read('docs/tiers/sme.md');
  assert.doesNotMatch(sme, /\$199|\$398|\$4,776|\$10,700/);
  assert.match(sme, /Business subscription, 20 computers \| contact us for a quote/);
});

test('Business support is quoted with the tier, not priced on its own', () => {
  for (const doc of ['docs/PRICING.md', 'docs/tiers/services.md', 'docs/tiers/sme.md', 'docs/tiers/README.md']) {
    const md = read(doc);
    assert.doesNotMatch(md, /20% of the (yearly )?subscription|\(20% plan\)|\$2,400\/year|\$5,900/, doc);
  }
  assert.match(read('docs/PRICING.md'), /\| Business support \| quoted with the tier \|/);
  assert.match(read('docs/tiers/services.md'), /\| Business support \| quoted with the tier \|/);
});
