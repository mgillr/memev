// SR-0.03 task 2: a project repository that tracks contracts/signed/x.json is judged on it like any file, while the vault's own
// contracts/ folder (what sign and verify write) is never part of the comparison when the vault itself is the workdir, however
// its path is spelled; a note outside the scope written by a vault write is still found.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, tmpdir } from './helpers/tmp.mjs';
import { repoAt, put, signScope, scopeResults, OWNER } from './helpers/scope.mjs';
after(cleanup);

test('in a project repository that tracks contracts/signed/x.json, changing that file is FAIL naming it', async () => {
  const { v } = newVault({ git: false });
  try {
    const { dir, base } = repoAt({ 'src/a/ok.js': 'ok\n', 'contracts/signed/x.json': '{}\n' });
    const id = signScope(v, { workdir: dir, base, tasks: { T1: ['src/**'] } });
    put(dir, { 'contracts/signed/x.json': '{"changed":true}\n' });
    const r = scopeResults(await v.contractVerify(OWNER, { id })).T1;
    assert.equal(r.status, 'FAIL', r.detail);
    assert.ok(r.detail.includes('contracts/signed/x.json'), r.detail);
  } finally { v.close(); }
});

const SPELLINGS = {
  'a symlink to the vault root': (root) => { const link = path.join(tmpdir('vault-link-'), 'vault-alias'); fs.symlinkSync(root, link); return link; },
  'the vault root spelled with dot segments': (root) => `${root}${path.sep}.${path.sep}..${path.sep}${path.basename(root)}`,
};

for (const [name, spell] of Object.entries(SPELLINGS)) {
  test(`with the vault root as workdir through ${name} and scope ['memory/**','work/**'], no contracts/ path is listed and notes/out.md is FAIL naming it`, async () => {
    const { v, root } = newVault();
    try {
      const wd = spell(root);
      const id = signScope(v, { workdir: wd, tasks: { T1: ['memory/**', 'work/**'] } });
      v.write(OWNER, { path: 'memory/in.md', body: 'a note inside the scope\n' });
      v.commits.flush();
      const clean = scopeResults(await v.contractVerify(OWNER, { id })).T1;
      assert.equal(clean.status, 'PASS', clean.detail);
      assert.ok(!clean.detail.includes('contracts/'), clean.detail);
      v.write(OWNER, { path: 'notes/out.md', body: 'a note outside the scope\n' });
      v.commits.flush();
      const again = scopeResults(await v.contractVerify(OWNER, { id })).T1;
      assert.equal(again.status, 'FAIL', again.detail);
      assert.ok(again.detail.includes('notes/out.md'), again.detail);
      assert.ok(!again.detail.includes('contracts/'), `the detail lists a contracts/ path: ${again.detail}`);
      // the receipt and the closed record sign and verify wrote are there, and uncommitted, and still not compared
      assert.ok(fs.existsSync(path.join(root, 'contracts', 'receipts', `${id}.md`)));
      const third = scopeResults(await v.contractVerify(OWNER, { id })).T1;
      assert.ok(!third.detail.includes('contracts/'), third.detail);
    } finally { v.close(); }
  });
}
