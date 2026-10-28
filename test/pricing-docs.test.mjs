// The core is free. Personal with more computers is $12/month or $120/year, decided 28 October
// 2026. Business and Corporate have no public price, and neither does any service: contact us. So no other money
// figure may appear in the pricing docs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.md') ? [path.join(d, e.name)] : []));
// The scan covers the pricing table and the tier pages, which this contract owns. The root README price line
// belongs to MEM-054, and the rest of docs/ is outside this contract's scope.
const DOCS = ['CHARTER.md', 'SECURITY.md', 'docs/PRICING.md', ...walk('docs/tiers')];
// Personal $12/month or $120/year. No other tier has a published price, and there is no per-computer add-on.
const ALLOWED = new Set(['$12/month', '$120/year']);
// The all-docs scan keeps the wider set: the root README price line and docs/SOLUTIONS.md still carry the CHF
// equivalents, and both are outside this contract's scope.
const WIDE_DOCS = ['README.md', 'CHARTER.md', 'SECURITY.md', ...walk('docs')];
const WIDE_ALLOWED = new Set(['$12/month', '$120/year', 'CHF 10', 'CHF 100']);
const MONEY = /[$€£]\s?\d[\d,.]*(?:k\b)?(?:\/(?:month|year|day))?|\bCHF\s?\d[\d,.]*|\b\d[\d,.]*\s?(?:USD|EUR|GBP|CHF|dollars?)\b/gi;

test('the docs show no money figure except the list prices', () => {
  const found = [];
  for (const doc of DOCS) {
    read(doc).split('\n').forEach((line, i) => { for (const m of line.matchAll(MONEY)) if (!ALLOWED.has(m[0])) found.push(`${doc}:${i + 1}: ${m[0]}`); });
  }
  assert.deepEqual(found, []);
});

test('the whole docs tree shows no money figure except the list prices and the CHF equivalents', () => {
  const found = [];
  for (const doc of WIDE_DOCS) {
    read(doc).split('\n').forEach((line, i) => { for (const m of line.matchAll(MONEY)) if (!WIDE_ALLOWED.has(m[0])) found.push(`${doc}:${i + 1}: ${m[0]}`); });
  }
  assert.deepEqual(found, []);
});

test('the price row matches the decided tiers', () => {
  const row = read('docs/PRICING.md').split('\n').find((l) => l.startsWith('| Price |')).split('|').map((c) => c.trim()).filter(Boolean);
  assert.deepEqual(row, [
    'Price',
    'free',
    '$12/month or $120/year',
    'contact us',
    'contact us',
  ]);
  assert.match(read('docs/PRICING.md'), /up to 3/);
  assert.doesNotMatch(read('docs/PRICING.md'), /\| (Office|Team|Enterprise) \|/);
  assert.match(read('docs/tiers/free.md'), /\$12\/month or \$120\/year\./);
  assert.match(read('README.md'), /\$12\/month or \$120\/year/);
});

test('the docs carry no price left from before 28 October 2026', () => {
  const stale = new RegExp([15, 144, 18, 216, 22, 24].map((n) => '\\$' + n + '\\b').join('|'));
  const found = [];
  for (const doc of DOCS) read(doc).split('\n').forEach((l, i) => { if (stale.test(l)) found.push(`${doc}:${i + 1}`); });
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

test('MEM-088 AC08: the Personal price is exactly $12/month or $120/year in the pricing table, the tiers price row and free.md, and the old figures are gone from docs', () => {
  const priceCell = (p, i) => read(p).split('\n').find((l) => l.startsWith('| Price |')).split('|').map((c) => c.trim()).filter(Boolean)[i];
  assert.equal(priceCell('docs/PRICING.md', 2), '$12/month or $120/year');
  const tiersCell = priceCell('docs/tiers/README.md', 2);
  assert.ok(tiersCell.startsWith('$12/month or $120/year'), tiersCell);
  for (const m of tiersCell.matchAll(MONEY)) assert.ok(ALLOWED.has(m[0]), `${m[0]} in ${tiersCell}`);
  const freeLine = read('docs/tiers/free.md').split('\n').find((l) => l.includes('$12/month'));
  assert.match(freeLine, /for \$12\/month or \$120\/year\./);
  for (const m of freeLine.matchAll(MONEY)) assert.ok(ALLOWED.has(m[0]), `${m[0]} in ${freeLine}`);
  for (const doc of walk('docs')) {
    assert.doesNotMatch(read(doc), /\$15\/month/, doc);
    assert.doesNotMatch(read(doc), /\$144\/year/, doc);
  }
});

test('MEM-088 AC09: Business and Corporate show no price: their Price row cells read contact us in both tables, and the business and corporate pages carry no dollar amount', () => {
  for (const p of ['docs/PRICING.md', 'docs/tiers/README.md']) {
    const row = read(p).split('\n').find((l) => l.startsWith('| Price |')).split('|').map((c) => c.trim()).filter(Boolean);
    assert.match(row[3], /contact us/);
    assert.match(row[4], /contact us/);
    for (const cell of [row[3], row[4]]) for (const m of cell.matchAll(MONEY)) assert.ok(ALLOWED.has(m[0]), `${p}: ${m[0]}`);
  }
  for (const p of ['docs/tiers/business.md', 'docs/tiers/corporate.md']) assert.doesNotMatch(read(p), /\$\s?\d/, p);
});

test('MEM-088 AC10: the allowed money figures are exactly the two list prices, the stale per-seat assertions are gone, and the services section carries no money figure', () => {
  const self = read('test/pricing-docs.test.mjs');
  const setLine = self.split('\n').find((l) => l.startsWith('const ALLOWED = new Set('));
  assert.deepEqual(setLine.match(/'[^']*'/g).map((s) => s.slice(1, -1)), ['$12/month', '$120/year']);
  for (const n of [18, 216, 22, 24]) assert.doesNotMatch(self, new RegExp('\\$' + n + '\\b'));
  const section = read('docs/PRICING.md').split('## Services for Business and Corporate')[1].split('\n## ')[0];
  for (const m of section.matchAll(MONEY)) assert.fail(`money figure in the services section: ${m[0]}`);
});

test('MEM-088 AC11: the copy this contract writes is plain, with no hype, no not-just-but framing, no emoji, no exclamation marks, no em-dash, and never the word certified', () => {
  const files = ['docs/PRICING.md', 'docs/tiers/README.md', 'docs/tiers/free.md', 'changelog.d/MEM-088.md'];
  const hype = /\b(seamless|robust|powerful|leverage|unlock|cutting-edge)\b/i;
  const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2B00}-\u{2BFF}]/u;
  for (const f of files) {
    const text = read(f);
    assert.doesNotMatch(text, hype, f);
    assert.doesNotMatch(text, /not just [^.\n]{0,80}\bbut\b/i, f);
    assert.doesNotMatch(text, emoji, f);
    assert.doesNotMatch(text, /!/, f);
    assert.doesNotMatch(text, /[\u2014]/, f);
    assert.doesNotMatch(text, /\bcertified\b/i, f);
  }
});
