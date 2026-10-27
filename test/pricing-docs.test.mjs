// Only Free and Personal have a set price. Everything else (Team, Office, Business, Enterprise and
// every service) is priced on the customer's requirements, so no other money figure may appear in
// the docs. This keeps a stale figure from coming back in a later edit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.md') ? [path.join(d, e.name)] : []));
const DOCS = ['README.md', 'CHARTER.md', 'SECURITY.md', ...walk('docs')];
// The Personal tier: $15/month or $144/year, +$4/month for each extra computer.
const ALLOWED = new Set(['$15/month', '$144/year', '$4/month']);
const MONEY = /[$€£]\s?\d[\d,.]*(?:k\b)?(?:\/(?:month|year|day))?|\b\d[\d,.]*\s?(?:USD|EUR|GBP|dollars?)\b/gi;

test('the docs show no money figure except the Free and Personal prices', () => {
  const found = [];
  for (const doc of DOCS) {
    read(doc).split('\n').forEach((line, i) => { for (const m of line.matchAll(MONEY)) if (!ALLOWED.has(m[0])) found.push(`${doc}:${i + 1}: ${m[0]}`); });
  }
  assert.deepEqual(found, []);
});

test('Free and Personal keep their prices; the other tiers say contact us', () => {
  const row = read('docs/PRICING.md').split('\n').find((l) => l.startsWith('| Price |')).split('|').map((c) => c.trim()).filter(Boolean);
  assert.deepEqual(row, ['Price', 'free', '$15/month or $144/year', 'contact us', 'contact us', 'contact us', 'contact us']);
  assert.match(read('docs/PRICING.md'), /up to 4 \(\+\$4\/month each\)/);
  assert.match(read('docs/tiers/free.md'), /\$15\/month or \$144\/year/);
});

test('Business support is quoted with the tier', () => {
  assert.match(read('docs/PRICING.md'), /support plans/);
  assert.match(read('docs/tiers/services.md'), /\| Business support \| quoted with the tier \|/);
});
