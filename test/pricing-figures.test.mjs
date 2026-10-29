// The price figures in README.md and docs/SOLUTIONS.md are the same strings as in docs/PRICING.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('REV-032 AC04: the price figures in README.md and docs/SOLUTIONS.md are the same strings as in docs/PRICING.md', () => {
  const pricing = read('docs/PRICING.md');
  const priceRow = pricing.split('\n').find((l) => l.startsWith('| Price |'));
  assert.match(priceRow, /\$12\/month or \$120\/year/);

  const readme = read('README.md');
  const readmePriceRow = readme.split('\n').find((l) => l.startsWith('| Price |'));
  assert.match(readmePriceRow, /\$12\/month or \$120\/year \(CHF 10 or CHF 100\)/);

  const solutions = read('docs/SOLUTIONS.md');
  assert.match(solutions, /\$12\/month or \$120\/year, CHF 10 or CHF 100/);

  assert.match(pricing, /\$12\/month or \$120\/year/);
  assert.match(readme, /\$12\/month or \$120\/year/);
  assert.match(solutions, /\$12\/month or \$120\/year/);
  assert.match(readme, /CHF 10 or CHF 100/);
  assert.match(solutions, /CHF 10 or CHF 100/);
});
