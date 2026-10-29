// The npm test script's own glob must reach every test file, including the MEM-070 ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Expand the script's glob (test/*.test.mjs or test/**/*.test.mjs) the way the shell would,
// so the test runs exactly the files the npm test command would run.
function expandGlob(pattern) {
  const segs = pattern.split('/');
  let cur = ['.'];
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const last = i === segs.length - 1;
    const next = new Set();
    for (const dir of cur) {
      if (seg === '**') {
        const stack = [dir];
        while (stack.length) {
          const d = stack.pop();
          next.add(d);
          for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) stack.push(path.join(d, e.name));
        }
        continue;
      }
      const re = seg.includes('*') ? new RegExp('^' + seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$') : null;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory() !== !last) continue;
        if (re ? !re.test(e.name) : e.name !== seg) continue;
        next.add(path.join(dir, e.name));
      }
    }
    cur = [...next];
  }
  return cur.sort();
}

test('REV-013 AC01: the npm test command reaches the MEM-070 tests: running package.json\'s test glob with the MEM-070 name pattern prints an ok line for each MEM-070 criterion', () => {
  const script = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts.test;
  const glob = script.trim().split(/\s+/).find((t) => t.startsWith('test/'));
  assert.ok(glob, `a test glob in the test script: ${script}`);
  const files = expandGlob(glob);
  assert.ok(files.includes('test/mem-070.test.mjs'), `the glob ${glob} reaches the MEM-070 tests`);
  // anchored, so this harness (whose title mentions MEM-070) does not run itself inside the run;
  // NODE_TEST_CONTEXT is dropped so the child runner does not see itself as a recursive run
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=^MEM-070 AC', ...files], { encoding: 'utf8', cwd: ROOT, env, timeout: 180000 });
  assert.equal(r.status, 0, `the glob's files pass with the MEM-070 pattern:\n${r.stdout.slice(-3000)}\n${r.stderr.slice(-1000)}`);
  const okLines = r.stdout.split('\n').filter((l) => /^ *ok \d+ - MEM-070 AC\d+:/.test(l));
  assert.ok(okLines.some((l) => l.includes('MEM-070 AC01:')), 'an ok line for the MEM-070 AC01 test');
  assert.ok(okLines.some((l) => l.includes('MEM-070 AC02:')), 'an ok line for the MEM-070 AC02 test');
  assert.ok(!/^ *not ok /m.test(r.stdout), `no failing test in the glob's run:\n${r.stdout.slice(-3000)}`);
});
