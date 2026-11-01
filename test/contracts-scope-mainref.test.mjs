// SR-0.03 task 2: no ref decides what is excluded. The range is the recorded base to HEAD, so a commit on main itself, a
// commit made before main was moved onto it, a remote-tracking ref set to HEAD and a fetch from a remote whose main is HEAD
// leave an out-of-scope commit in the range.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { newVault, cleanup, tmpdir } from './helpers/tmp.mjs';
import { repoAt, commitFiles, gitIn, signScope, scopeResults, OWNER } from './helpers/scope.mjs';
after(cleanup);

const FILES = { 'src/a/ok.js': 'ok\n', 'src/b/x.js': 'x\n' };
const verify = async (v, id) => scopeResults(await v.contractVerify(OWNER, { id })).T1;
const fails = (r, file, sha) => { assert.equal(r.status, 'FAIL', r.detail); assert.ok(r.detail.includes(file) && r.detail.includes(sha), r.detail); };

test('(i) an out-of-scope commit on main itself, so HEAD is main, is FAIL naming the path and the commit', async () => {
  const { v } = newVault({ git: false });
  try {
    const { dir, base } = repoAt(FILES);
    const id = signScope(v, { workdir: dir, base, tasks: { T1: ['src/a/**'] } });
    const x = commitFiles(dir, { 'src/b/x.js': 'changed on main\n' }, 'I change src/b/x.js on main');
    assert.equal(gitIn(dir, 'rev-parse', 'HEAD'), gitIn(dir, 'rev-parse', 'main'));
    fails(await verify(v, id), 'src/b/x.js', x);
  } finally { v.close(); }
});

test('(ii) an out-of-scope commit X, then git branch -f main HEAD, then an in-scope commit Y: FAIL naming X', async () => {
  const { v } = newVault({ git: false });
  try {
    const { dir, base } = repoAt(FILES);
    const id = signScope(v, { workdir: dir, base, tasks: { T1: ['src/a/**'] } });
    gitIn(dir, 'checkout', '-q', '-b', 'work');
    const x = commitFiles(dir, { 'src/b/x.js': 'changed\n' }, 'I change src/b/x.js');
    gitIn(dir, 'branch', '-f', 'main', 'HEAD');
    commitFiles(dir, { 'src/a/ok.js': 'changed\n' }, 'I change src/a/ok.js');
    fails(await verify(v, id), 'src/b/x.js', x);
  } finally { v.close(); }
});

test('(iii) with the vault root as the workdir and scope [memory/**], a note outside it written by a vault write is FAIL naming it and its commit', async () => {
  const { v, root } = newVault();
  try {
    const id = signScope(v, { workdir: root, tasks: { T1: ['memory/**'] } });
    v.write(OWNER, { path: 'notes/out.md', body: 'outside the scope\n' });
    v.commits.flush();
    const sha = gitIn(root, 'log', '-1', '--format=%H', '--', 'notes/out.md');
    assert.equal(gitIn(root, 'rev-parse', 'HEAD'), gitIn(root, 'rev-parse', 'main'));
    fails(await verify(v, id), 'notes/out.md', sha);
  } finally { v.close(); }
});

test('(iv) refs/remotes/origin/main set to HEAD, and a fetch from a local remote whose main is HEAD, leave the commit in the range', async () => {
  const { v } = newVault({ git: false });
  try {
    for (const how of ['update-ref', 'fetch']) {
      const { dir, base } = repoAt(FILES);
      const id = signScope(v, { workdir: dir, base, tasks: { T1: ['src/a/**'] } });
      gitIn(dir, 'checkout', '-q', '-b', 'work');
      const x = commitFiles(dir, { 'src/b/x.js': 'changed\n' }, 'I change src/b/x.js');
      if (how === 'update-ref') gitIn(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
      else {
        const remote = tmpdir('mainref-remote-');
        gitIn(remote, 'init', '-q', '--bare', '-b', 'main');
        gitIn(dir, 'remote', 'add', 'origin', remote);
        gitIn(remote, 'fetch', '-q', dir, 'HEAD:refs/heads/main'); // the remote's main is HEAD
        gitIn(dir, 'fetch', '-q', 'origin');
        assert.equal(gitIn(dir, 'rev-parse', 'refs/remotes/origin/main'), x);
      }
      fails(await verify(v, id), 'src/b/x.js', x);
    }
  } finally { v.close(); }
});
