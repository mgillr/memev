// SR-0.03 task 1: an explicit base is a 40-hex commit sha and nothing else, so no value can reach git as an option or a ref;
// and a base the workdir's HEAD does not descend from never judges scope or red-green.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, tmpdir, OWNER } from './helpers/tmp.mjs';
import { gitRepo, commit, gitIn, task, signByHand, byStatement, servedVault, gitSpy } from './helpers/contracts-base.mjs';
after(cleanup);

const FILE = { statement: 'the file exists', verifier: { type: 'file_exists', path: 'README.md' } };
const drafts = (root) => { try { return fs.readdirSync(path.join(root, 'contracts', 'drafts')).sort(); } catch { return []; } };

test('contractDraft and memev_contract_draft over MCP, with a local and a remote token, refuse a base that is not 40 hex, and write no draft', async () => {
  const s = await servedVault();
  try {
    const { dir, head } = gitRepo();
    const bad = ['--output=x', 'HEAD', 'abc', `${head}a`];
    const before = drafts(s.root);
    for (const base of bad) {
      assert.throws(() => s.v.contractDraft(OWNER, { title: 'Bad base', workdir: dir, base, tasks: task([FILE]) }), (e) => e.code === 'bad_request' && /40 hex/.test(e.message), `contractDraft took base ${base}`);
      await assert.rejects(s.local('memev_contract_draft', { title: 'Bad base', workdir: dir, base, tasks: task([FILE]) }), /40 hex/, `a local token drafted with base ${base}`);
      await assert.rejects(s.remote('memev_contract_draft', { title: 'Bad base', workdir: dir, base, tasks: task([FILE]) }), /40 hex/, `a remote token drafted with base ${base}`);
    }
    assert.deepEqual(drafts(s.root), before, 'a draft was written');
    // the same call with a 40-hex base is taken, so the refusals above are about the value
    const ok = await s.local('memev_contract_draft', { title: 'Good base', workdir: dir, base: head, tasks: task([FILE]) });
    assert.match(ok.id, /^k-/);
  } finally { await s.close(); }
});

test('a hand-signed base that reads as an option is BLOCKED on scope and red-green and never reaches git', async () => {
  const s = await servedVault({ git: false });
  try {
    const { dir } = gitRepo();
    const pwned = path.join(tmpdir('base-pwned-'), 'pwned');
    const criteria = [
      { statement: 'changes stay in scope', verifier: { type: 'scope' } },
      { statement: 'red then green', verifier: { type: 'test_red_green', test_file: 'README.md', cmd: 'exit 0' } },
    ];
    const marker = path.join(tmpdir('base-spy-'), 'git-args');
    const savedPath = process.env.PATH;
    for (const base of [{ sha: `--output=${pwned}`, recorded_at: new Date().toISOString() }, `--output=${pwned}`]) {
      const k = signByHand(s.root, { workdir: dir, tasks: task(criteria), fields: { base } });
      process.env.PATH = `${gitSpy(marker)}${path.delimiter}${savedPath}`;
      let r; try { r = await s.v.contractVerify(OWNER, { id: k.id }); } finally { process.env.PATH = savedPath; }
      assert.ok(!(fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').includes('--output')), 'the base reached git');
      assert.equal(s.v.contractCheckSignature(k.id).ok, true);
      for (const name of ['changes stay in scope', 'red then green']) assert.equal(byStatement(r)[name].status, 'BLOCKED', `${name} with base ${JSON.stringify(base)}`);
      assert.equal(fs.existsSync(pwned), false, 'git wrote the file the base named');
    }
  } finally { await s.close(); }
});

test('an explicit base that exists but is not an ancestor of HEAD is BLOCKED naming it', async () => {
  const s = await servedVault({ git: false });
  try {
    const { dir } = gitRepo();
    const main = gitIn(dir, 'rev-parse', '--abbrev-ref', 'HEAD');
    gitIn(dir, 'checkout', '-q', '-b', 'side');
    const side = commit(dir, { 'side.txt': 'side\n' }, 'side');
    gitIn(dir, 'checkout', '-q', main);
    commit(dir, { 'src/a.js': 'export const a = 1;\n' });
    const d = s.v.contractDraft(OWNER, { title: 'Side base', workdir: dir, base: side, tasks: task([
      { statement: 'changes stay in scope', verifier: { type: 'scope' } },
      { statement: 'red then green', verifier: { type: 'test_red_green', test_file: 'README.md', cmd: 'exit 0' } },
    ]) });
    s.v.contractSign(OWNER, { id: d.id });
    const r = await s.v.contractVerify(OWNER, { id: d.id });
    for (const name of ['changes stay in scope', 'red then green']) {
      assert.equal(byStatement(r)[name].status, 'BLOCKED');
      assert.equal(byStatement(r)[name].detail, `base ${side} is not an ancestor of HEAD`);
    }
  } finally { await s.close(); }
});
