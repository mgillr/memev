// Build the release tarball and a SHA-256 file beside it. The file list is the one npm publishes.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let out = process.cwd();
const at = args.indexOf('--out');
if (at >= 0 && args[at + 1]) out = path.resolve(args[at + 1]);
fs.mkdirSync(out, { recursive: true });
execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', out], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
const names = fs.readdirSync(out).filter((f) => f.endsWith('.tgz') || f.endsWith('.tar.gz'));
if (names.length !== 1) {
  console.error('expected one tarball, found ' + names.join(', '));
  process.exit(1);
}
const file = path.join(out, names[0]);
const hash = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
fs.writeFileSync(file + '.sha256', hash + '  ' + names[0] + '\n');
console.log(file);
