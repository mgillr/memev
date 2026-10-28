// The core is free. Personal with more computers is $12/month or $120/year (CHF 10 or CHF 100), decided 28 October
// 2026. Business and Corporate have no public price, and neither does any service: contact us. So no other money
// figure may appear in the docs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.md') ? [path.join(d, e.name)] : []));
const DOCS = ['README.md', 'CHARTER.md', 'SECURITY.md', ...walk('docs')];
// Personal $12/month or $120/year, CHF 10 or CHF 100. No other tier has a published price, and there is no per-computer add-on.
const ALLOWED = new Set(['$12/month', '$120/year', 'CHF 10', 'CHF 100']);
const MONEY = /[$€£]\s?\d[\d,.]*(?:k\b)?(?:\/(?:month|year|day))?|\bCHF\s?\d[\d,.]*|\b\d[\d,.]*\s?(?:USD|EUR|GBP|CHF|dollars?)\b/gi;

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
    '$12/month or $120/year (CHF 10 or CHF 100)',
    'contact us',
    'contact us',
  ]);
  assert.match(read('docs/PRICING.md'), /up to 3/);
  assert.doesNotMatch(read('docs/PRICING.md'), /\| (Office|Team|Enterprise) \|/);
  assert.match(read('docs/tiers/free.md'), /\$12\/month or \$120\/year \(CHF 10 or CHF 100\)/);
  assert.match(read('README.md'), /\$12\/month or \$120\/year \(CHF 10 or CHF 100\)/);
});

test('the docs carry no price left from before 28 October 2026', () => {
  const found = [];
  for (const doc of DOCS) read(doc).split('\n').forEach((l, i) => { if (/\$15\b|\$144\b|\$18\b|\$216\b|\$22\b|\$24\b/.test(l)) found.push(`${doc}:${i + 1}`); });
  assert.deepEqual(found, []);
});

test('Business and Corporate services are quoted', () => {
  const pricing = read('docs/PRICING.md');
  const section = pricing.split('## Services for Business and Corporate')[1].split('\n## ')[0];
  assert.match(pricing, /## Services for Business and Corporate/);
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
