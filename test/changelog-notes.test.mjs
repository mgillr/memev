// Changelog notes: a change adds changelog.d/<CONTRACT-ID>.md; scripts/changelog-assemble.mjs folds the notes into
// CHANGELOG.md, and its --guard fails a pull request that edits CHANGELOG.md any other way.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir, cleanup, PKG } from './helpers/tmp.mjs';
import { assemble, fold, guard, parseNote } from '../scripts/changelog-assemble.mjs';

after(() => cleanup());
const SCRIPT = path.join(PKG, 'scripts', 'changelog-assemble.mjs');
const BASE = '# Changelog\n\n## Unreleased\n\n- An older entry written before the notes.\n\n## 0.1.0\n\n- The first release.\n';
const write = (root, files) => { for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), t); } };
const read = (root, f) => fs.readFileSync(path.join(root, f), 'utf8');
const run = (root, ...args) => spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf8' });

test('notes fold under Unreleased in their sections, newest on top, and are deleted', () => {
  const root = tmpdir('notes-');
  write(root, {
    'CHANGELOG.md': BASE,
    'changelog.d/README.md': '# Changelog notes\n',
    'changelog.d/MEM-001.md': '### Added\n\n- `memev ready` waits for the apps to join.\n- A second line that runs on\n  over two lines.\n',
    'changelog.d/MEM-002.md': '### Fixed\n\n- A spawn with no binary no longer crashes.\n',
  });
  assert.deepEqual(assemble(root).notes, ['changelog.d/MEM-001.md', 'changelog.d/MEM-002.md']);
  assert.equal(read(root, 'CHANGELOG.md'), [
    '# Changelog', '', '## Unreleased', '',
    '### Added', '', '- `memev ready` waits for the apps to join.', '- A second line that runs on', '  over two lines.', '',
    '### Fixed', '', '- A spawn with no binary no longer crashes.', '',
    '- An older entry written before the notes.', '',
    '## 0.1.0', '', '- The first release.', '',
  ].join('\n'));
  assert.deepEqual(fs.readdirSync(path.join(root, 'changelog.d')), ['README.md'], 'the notes are gone, the README stays');
  // with no notes nothing changes; a later note goes on top of its existing section
  const once = read(root, 'CHANGELOG.md');
  assert.equal(assemble(root).changed, false); assert.equal(read(root, 'CHANGELOG.md'), once);
  write(root, { 'changelog.d/MEM-003.md': '### Added\n\n- Newer.\n' }); assemble(root);
  assert.match(read(root, 'CHANGELOG.md'), /### Added\n\n- Newer\.\n- `memev ready`/);
});

test('--check changes nothing, and a malformed note fails with its name', () => {
  const root = tmpdir('notes-');
  write(root, { 'CHANGELOG.md': BASE, 'changelog.d/MEM-001.md': '### Changed\n\n- Something.\n' });
  const r = run(root, '--check');
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /would fold 1 note\(s\): changelog\.d\/MEM-001\.md/);
  assert.equal(read(root, 'CHANGELOG.md'), BASE); assert.ok(fs.existsSync(path.join(root, 'changelog.d/MEM-001.md')));
  for (const [bad, why] of [['- No heading.\n', /text before the first/], ['### Improved\n\n- x\n', /unknown section "Improved"/], ['### Added\n\n', /no bullet/], ['### Added\n\nplain text\n', /expected a "- " bullet/]]) {
    write(root, { 'changelog.d/MEM-009.md': bad });
    const f = run(root, '--check');
    assert.equal(f.status, 1); assert.match(f.stderr, /changelog\.d\/MEM-009\.md/); assert.match(f.stderr, why);
  }
});

test('the guard fails a hand edit of CHANGELOG.md and passes a note, the fold, a release and a branch opened before the rule', () => {
  const root = tmpdir('notes-repo-');
  const git = (...a) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  write(root, { 'CHANGELOG.md': BASE, 'package.json': '{ "name": "x", "version": "0.1.0" }\n', 'changelog.d/README.md': '# Notes\n', 'changelog.d/MEM-001.md': '### Added\n\n- Waiting note.\n' });
  git('add', '-A'); git('commit', '-q', '-m', 'base');
  const branch = (name, files, del = []) => {
    git('checkout', '-q', '-B', name, 'main'); write(root, files); for (const f of del) fs.rmSync(path.join(root, f));
    git('add', '-A'); git('commit', '-q', '--allow-empty', '-m', name);
  };
  const handEdit = { 'CHANGELOG.md': BASE.replace('## Unreleased\n\n', '## Unreleased\n\n- Typed straight in.\n') };
  branch('hand-edit', handEdit);
  assert.throws(() => guard(root, 'main', { branch: 'hand-edit' }), /edited by hand.*changelog\.d\/<CONTRACT-ID>\.md/s);
  branch('with-note', { 'changelog.d/MEM-003.md': '### Fixed\n\n- A note.\n', 'src.js': 'x\n' });
  assert.match(guard(root, 'main', { branch: 'with-note' }), /not changed/);
  branch('bad-note', { 'changelog.d/MEM-004.md': 'no heading\n' });
  assert.throws(() => guard(root, 'main', { branch: 'bad-note' }), /changelog\.d\/MEM-004\.md: text before/);
  // the release step: the script's own fold passes, and the same fold with a hand edit on top does not
  git('checkout', '-q', '-B', 'fold', 'main'); assemble(root); git('add', '-A'); git('commit', '-q', '-m', 'fold');
  assert.match(guard(root, 'main', { branch: 'fold' }), /the notes folded in: changelog\.d\/MEM-001\.md/);
  fs.appendFileSync(path.join(root, 'CHANGELOG.md'), '- And one more by hand.\n'); git('commit', '-q', '-am', 'fold plus');
  assert.throws(() => guard(root, 'main', { branch: 'fold' }), /edited by hand/);
  branch('release', { ...handEdit, 'package.json': '{ "name": "x", "version": "0.2.0" }\n' });
  assert.match(guard(root, 'main', { branch: 'release' }), /a release: package\.json goes from 0\.1\.0 to 0\.2\.0/);
  branch('mem-114-resume-card', handEdit);
  assert.match(guard(root, 'main', { branch: 'mem-114-resume-card' }), /opened before the rule/);
  // the command line form, as the pull request check runs it
  git('checkout', '-q', 'hand-edit');
  const r = spawnSync(process.execPath, [SCRIPT, '--root', root, '--guard', 'main'], { encoding: 'utf8', env: { ...process.env, GITHUB_HEAD_REF: 'hand-edit' } });
  assert.equal(r.status, 1); assert.match(r.stderr, /edited by hand/);
});

test('every note in this repository is well formed', () => {
  const dir = path.join(PKG, 'changelog.d');
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.md') && x !== 'README.md') : []) parseNote(fs.readFileSync(path.join(dir, f), 'utf8'), f);
  assert.ok(fs.existsSync(path.join(dir, 'README.md')), 'changelog.d/README.md says how to write a note');
  assert.doesNotThrow(() => fold(BASE, []));
});
