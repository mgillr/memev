// The project a memory belongs to is the slug of the git top-level folder (or the folder itself
// outside a repository), and recall hard-scopes to it. `memev project` shows that name and where
// it came from, `memev project set` pins a name for the repository or folder in the vault config,
// and non-Latin folder names keep their own slug instead of collapsing to 'untitled'.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir, cleanup, PKG } from './helpers/tmp.mjs';
import { sandbox, BIN } from './helpers/cli.mjs';
import { initVault } from '../src/engine/vault.mjs';
import { slug } from '../src/engine/util.mjs';
import { projectOf, projectInfo } from '../src/cli/hooks.mjs';

after(cleanup);

const sb = sandbox();
const cli = (args, { cwd, root } = {}) => {
  const env = { ...sb.env, ...(root ? { MEMEV_ROOT: root } : {}) };
  const r = spawnSync(process.execPath, [BIN, ...args], { env, cwd, encoding: 'utf8', timeout: 30000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const gitRepo = (name) => {
  const d = path.join(tmpdir(), name);
  fs.mkdirSync(d, { recursive: true });
  execFileSync('git', ['init', d], { env: sb.env });
  return d;
};
const vault = () => {
  const r = path.join(tmpdir(), 'vault');
  initVault(r, { template: path.join(PKG, 'templates', 'vault') });
  return r;
};

test('REV-023 AC01: memev project prints the project name used for the current folder and where it came from', () => {
  // outside a repository: the folder itself
  const plain = path.join(tmpdir(), 'plain-folder');
  fs.mkdirSync(plain);
  let r = cli(['project'], { cwd: plain });
  assert.equal(r.code, 0, `project failed: ${r.err}`);
  assert.ok(r.out.includes('plain-folder'), `missing the folder name: ${r.out}`);
  assert.match(r.out, /the folder /, 'says the name came from the folder itself');

  // inside a repository: the git top-level folder, even from a subfolder
  const repo = gitRepo('top-level-repo');
  const sub = path.join(repo, 'src', 'deep');
  fs.mkdirSync(sub, { recursive: true });
  r = cli(['project'], { cwd: sub });
  assert.equal(r.code, 0, `project failed: ${r.err}`);
  assert.ok(r.out.includes('top-level-repo'), `missing the top-level name: ${r.out}`);
  assert.match(r.out, /the git top-level folder /, 'says the name came from the git top-level folder');

  // pinned: the pin wins and is named as the source
  const v = vault();
  const pin = cli(['project', 'set', 'pinned-name'], { cwd: repo, root: v });
  assert.equal(pin.code, 0, `project set failed: ${pin.err}`);
  r = cli(['project'], { cwd: sub, root: v });
  assert.equal(r.code, 0, `project failed: ${r.err}`);
  assert.ok(r.out.includes('pinned-name'), `missing the pinned name: ${r.out}`);
  assert.match(r.out, /pinned/, 'says the name is pinned');
});

test('REV-023 AC02: memev project set <name> pins a name for this repository or folder and the hooks use it from then on', () => {
  const v = vault();
  const repo = gitRepo('some-repo');
  const r = cli(['project', 'set', 'My Pinned App'], { cwd: repo, root: v });
  assert.equal(r.code, 0, `project set failed: ${r.err}`);
  // the pin is stored in the vault config, keyed by the repository
  const cfg = JSON.parse(fs.readFileSync(path.join(v, '.memev', 'config.json'), 'utf8'));
  assert.equal(cfg.projects?.[repo], 'My Pinned App', 'the pin is in the vault config for the repository');
  // the hook's project resolution uses it from then on, from any subfolder of the repository
  const sub = path.join(repo, 'a', 'b');
  fs.mkdirSync(sub, { recursive: true });
  assert.equal(projectOf(sub, v), 'my-pinned-app', 'the hook resolves the pinned name from a subfolder');
  assert.equal(projectInfo(sub, v).source, 'pinned', 'the source is the pin');
  // a folder with no pin keeps its own name
  const other = gitRepo('other-repo');
  assert.equal(projectOf(other, v), 'other-repo', 'an unpinned repository keeps its folder name');
});

test('REV-023 AC03: a folder named in Japanese or Cyrillic gets a stable project name of its own, never untitled', () => {
  // the slug keeps Unicode letters and digits
  assert.equal(slug('プロジェクト'), 'プロジェクト', 'a Japanese name keeps its letters');
  assert.equal(slug('проект'), 'проект', 'a Cyrillic name keeps its letters');
  assert.equal(slug('Мой Проект'), 'мой-проект', 'a Cyrillic name with a space slugs like an English one');
  assert.notEqual(slug('プロジェクト'), slug('проект'), 'different non-Latin names stay distinct');
  // stable: the same folder name gives the same project name, run after run
  const jp = path.join(tmpdir(), '日本語フォルダ');
  fs.mkdirSync(jp);
  const a = projectInfo(jp);
  const b = projectInfo(jp);
  assert.equal(a.name, b.name, 'the project name is stable');
  assert.equal(a.name, slug('日本語フォルダ'), 'the Japanese folder gets its own slug');
  assert.notEqual(a.name, 'untitled', 'a Japanese folder never becomes untitled');
  const cy = path.join(tmpdir(), 'НовыйПроект');
  fs.mkdirSync(cy);
  assert.equal(projectInfo(cy).name, 'новыйпроект', 'a Cyrillic folder gets its own slug');
  assert.notEqual(projectInfo(cy).name, 'untitled', 'a Cyrillic folder never becomes untitled');
});
