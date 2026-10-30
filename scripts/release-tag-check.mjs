// Check that a release tag matches the version in package.json, the single source of the version.
// Usage: node scripts/release-tag-check.mjs <tag>
// Exits 0 when the tag is v<version>, non-zero otherwise.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const tag = process.argv[2];
if (!tag) {
  console.error('usage: node scripts/release-tag-check.mjs <tag>');
  process.exit(2);
}
const expected = 'v' + pkg.version;
if (tag !== expected) {
  console.error(`tag ${tag} does not match version ${pkg.version} in package.json (expected ${expected})`);
  process.exit(1);
}
console.log(`tag ${tag} matches version ${pkg.version} in package.json`);
