// Free is free. Personal, Team and Business have the list prices below. Enterprise and every
// service stay contact us, so no other money figure may appear in the docs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.md') ? [path.join(d, e.name)] : []));
const DOCS = ['README.md', 'CHARTER.md', 'SECURITY.md', ...walk('docs')];
// Personal $15/month or $144/year. Team $18, $216 and $22. Business $24. No per-computer add-on.
const ALLOWED = new Set(['$15/month', '$144/year', '$18', '$216', '$22', '$24']);
const MONEY = /[$€£]\s?\d[\d,.]*(?:k\b)?(?:\/(?:month|year|day))?|\b\d[\d,.]*\s?(?:USD|EUR|GBP|dollars?)\b/gi;

test('the docs show no money figure except the list prices', () => {
  const found = [];
  for (const doc of DOCS) {
    read(doc).split('\n').forEach((line, i) => { for (const m of line.matchAll(MONEY)) if (!ALLOWED.has(m[0])) found.push(`${doc}:${i + 1}: ${m[0]}`); });
  }
  assert.deepEqual(found, []);
});

test('the price row matches the decided tiers', () => {
  const row = read('docs/PRICING.md').split('\n').find((l) => l.startsWith('| Price |')).split('|').map((c) => c.trim()).filter(Boolean);
  assert.deepEqual(row, [
    'Price',
    'free',
    '$15/month or $144/year',
    '$18/seat/month billed yearly ($216/seat/year), or $22/seat/month billed monthly. Contact us until member keys ship.',
    '$24/seat/month billed yearly, setup quoted. Contact us.',
    'contact us',
  ]);
  assert.match(read('docs/PRICING.md'), /up to 3/);
  assert.doesNotMatch(read('docs/PRICING.md'), /\| Office \|/);
  assert.match(read('docs/tiers/free.md'), /\$15\/month or \$144\/year/);
});

test('MEM-065 AC03: The pricing-docs test checks the Team row has a published price and its unit', () => {
  const row = read('docs/PRICING.md').split('\n').find((l) => l.startsWith('| Price |')).split('|').map((c) => c.trim()).filter(Boolean);
  const team = row[3];
  assert.match(team, /\$18\/seat\/month/);
  assert.match(team, /\$216\/seat\/year/);
  assert.match(team, /\$22\/seat\/month/);
});

test('Business and Enterprise services are quoted', () => {
  const pricing = read('docs/PRICING.md');
  const section = pricing.split('## Services for Business and Enterprise')[1].split('\n## ')[0];
  assert.match(pricing, /## Services for Business and Enterprise/);
  assert.match(section, /Standard: business-hours support/);
  assert.match(section, /Priority support/);
  assert.match(section, /24\/7 support with a critical-issue response target/);
  assert.match(section, /Remote setup package/);
  assert.match(section, /In-person setup/);
  assert.match(section, /Training and workshops/);
  assert.match(section, /Managed hosting/);
  assert.match(section, /quoted/i);
  assert.doesNotMatch(section, /[$€£]\s?\d/);
  assert.match(pricing, /support plans/);
  assert.match(read('docs/tiers/services.md'), /\| Business support \| quoted with the tier \|/);
});
