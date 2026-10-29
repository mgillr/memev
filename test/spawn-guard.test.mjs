// A binary that is not on PATH must never crash the CLI: the run helper reports it, and doctor
// says git is missing with the fix instead of dying on a null stdout.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/engine/util.mjs';
import { sandbox } from './helpers/cli.mjs';
import { tmpdir, cleanup } from './helpers/tmp.mjs';

after(() => cleanup());

test('MEM-002 AC01: doctor with no git on PATH reports git installed as failed with the fix line and does not throw', () => {
  const sb = sandbox();
  try {
    const empty = tmpdir('no-bin-'); // a PATH with nothing in it: git is not there
    const r = sb.run(['doctor'], { extraEnv: { PATH: empty } });
    const out = r.out + r.err;
    assert.doesNotMatch(out, /Cannot read properties|TypeError/, out);
    assert.match(r.out, /✗ git installed: not found on PATH/, r.out);
    assert.match(r.out, /fix: install git/, r.out);
    assert.equal(r.code, 1, out);
  } finally { sb.stop(); }
});

test('MEM-002 AC02: the run helper returns ok:false with an error message when the binary does not exist', () => {
  const r = run('memev-not-a-real-binary', ['--version']);
  assert.equal(r.ok, false);
  assert.equal(r.status, null);
  assert.equal(r.stdout, '');
  assert.ok(r.error, 'expected an error message');
  assert.match(r.error, /ENOENT|not found|No such file/i);
});
