import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('MEM-014 AC03: release-tarball.mjs produces a tarball and a .sha256 file whose hash matches', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-rel-'));
  try {
    execFileSync('node', ['scripts/release-tarball.mjs', '--out', out], { cwd: root });
    const names = fs.readdirSync(out).filter((f) => f.endsWith('.tgz') || f.endsWith('.tar.gz'));
    assert.equal(names.length, 1, names.join(','));
    const sum = fs.readFileSync(path.join(out, names[0] + '.sha256'), 'utf8').trim().split(/\s+/)[0];
    assert.equal(sum, sha256(path.join(out, names[0])));
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('MEM-014 AC02: install.sh installs from a local tarball URL and refuses a tarball whose SHA-256 does not match', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-ins-'));
  try {
    const bin = path.join(dir, 'package', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package', 'package.json'), '{"type":"module"}\n');
    fs.writeFileSync(path.join(bin, 'memev.mjs'), [
      "import fs from 'node:fs';",
      "if (process.argv[2] !== 'init') process.exit(2);",
      "fs.writeFileSync(process.env.MEMEV_INSTALL_MARKER, 'ok');",
      '',
    ].join('\n'));
    const tarball = path.join(dir, 'memev.tgz');
    execFileSync('tar', ['-czf', tarball, '-C', dir, 'package']);
    const good = sha256(tarball);
    const sum = path.join(dir, 'memev.tgz.sha256');
    fs.writeFileSync(sum, good + '  memev.tgz\n');
    const marker = path.join(dir, 'marker');
    execFileSync('bash', [path.join(root, 'scripts', 'install.sh'), 'file://' + tarball], {
      env: { ...process.env, MEMEV_INSTALL_MARKER: marker },
    });
    assert.equal(fs.readFileSync(marker, 'utf8'), 'ok');

    fs.writeFileSync(sum, '0000000000000000000000000000000000000000000000000000000000000000  memev.tgz\n');
    const badMarker = path.join(dir, 'marker-bad');
    let failed = false;
    try {
      execFileSync('bash', [path.join(root, 'scripts', 'install.sh'), 'file://' + tarball], {
        env: { ...process.env, MEMEV_INSTALL_MARKER: badMarker },
      });
    } catch (e) {
      failed = true;
      const text = `${e.stdout || ''}${e.stderr || ''}`;
      assert.match(text, /SHA-256 does not match/);
    }
    assert.equal(failed, true);
    assert.equal(fs.existsSync(badMarker), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
