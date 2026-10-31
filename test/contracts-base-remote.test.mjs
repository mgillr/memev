// SR-0.03 task 1: a remote caller's signature records no base and runs no git; the base comes from the workdir's HEAD at
// local approval, under a signed approval record that an edit on disk breaks.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, tmpdir, OWNER } from './helpers/tmp.mjs';
import { gitRepo, commit, task, signedBody, gitSpy } from './helpers/contracts-base.mjs';
after(cleanup);

// a remote computer's token, as it holds it: write on contracts/**
const REMOTE = { id: 'dev-remote', agent: 'laptop', scopes: ['read', 'write'], paths: ['contracts/**', 'memory/**', 'work/**'], remote: true };

test('a remote signature runs no git and records no base; approval records HEAD then; an edited approval base stops verify before any criterion runs', async () => {
  const { v, root } = newVault({ git: false });
  const savedPath = process.env.PATH;
  try {
    const { dir } = gitRepo({ 'src/a.js': 'export const a = 1;\n' });
    const out = path.join(tmpdir('base-remote-'), 'seen');
    const marker = path.join(tmpdir('base-spy-'), 'git-ran');
    process.env.PATH = `${gitSpy(marker)}${path.delimiter}${savedPath}`;
    const d = v.contractDraft(REMOTE, { title: 'Signed from afar', workdir: dir, tasks: task([
      { statement: 'the command sees the base', verifier: { type: 'command', cmd: `printf '%s\\n' "\${MEMEV_CONTRACT_BASE-unset}" >> '${out}'` } },
    ]) });
    const s = v.contractSign(REMOTE, { id: d.id, local: false });
    process.env.PATH = savedPath;
    assert.equal(s.origin, 'remote');
    assert.equal(fs.existsSync(marker), false, `git ran for a remote caller: ${fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : ''}`);
    assert.equal(signedBody(root, d.id).base, undefined, 'a remote signature recorded a base');
    assert.equal(s.base, null);

    // the base is the HEAD at approval, not the HEAD at verify
    const atApproval = commit(dir, { 'src/a.js': 'export const a = 2;\n' });
    const a = v.contractApprove(OWNER, { id: d.id });
    assert.equal(a.base, atApproval);
    commit(dir, { 'src/a.js': 'export const a = 3;\n' });
    const r = await v.contractVerify(OWNER, { id: d.id });
    assert.equal(r.ok, true, JSON.stringify(r.remaining));
    assert.equal(fs.readFileSync(out, 'utf8').trim().split('\n').pop(), atApproval);

    // an edit of the recorded approval base on disk: verify stops, and the command does not run
    const f = path.join(root, 'contracts', 'signed', `${d.id}.approval.txt`);
    const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
    rec.base.sha = 'e'.repeat(40);
    fs.writeFileSync(f, `${JSON.stringify(rec, null, 2)}\n`);
    const runs = fs.readFileSync(out, 'utf8');
    const r2 = await v.contractVerify(OWNER, { id: d.id });
    assert.equal(r2.ok, false);
    assert.ok(r2.detail === 'approval record changed' || !v.contractCheckSignature(d.id).ok, `verify went on: ${JSON.stringify(r2).slice(0, 300)}`);
    assert.deepEqual(r2.tasks, []);
    assert.equal(fs.readFileSync(out, 'utf8'), runs, 'a criterion ran after the approval record changed');
  } finally { process.env.PATH = savedPath; v.close(); }
});
