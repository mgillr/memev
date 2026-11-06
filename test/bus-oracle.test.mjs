// The indexed bus answers exactly as the bus before the index did: every call, on random histories with several computers,
// late and foreign lines, bad lines, rewritten files, renames and restarts. The reference is a copy of the old code. Each
// deliberately broken copy of the new code must be caught, so a pass here means the comparison could have failed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bus } from '../src/engine/bus.mjs';
import { Bus as Oracle } from './fixtures/bus-main-oracle.mjs';
import { lockstep, moduleCopy, BUS_SRC } from './helpers/bus-lockstep.mjs';

const SEEDS = 16;

test('every answer and every file matches the reference on random histories', async () => {
  let ran = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const diff = await lockstep({ A: Bus, B: Oracle, seed, steps: 140 });
    assert.equal(diff, null, diff || '');
    ran++;
  }
  assert.equal(ran, SEEDS);
});

// [what it breaks, the text in bus.mjs, what it becomes]
const BROKEN = [
  ['the order ignores the device', 'a.device < b.device ? -1 : a.device > b.device ? 1 : ', ''],
  ['a claim ignores its verdict', '!view.verdicts.has(m.ref)', 'true'],
  ['a file changed on disk is not noticed', 'return c.size === st.size && c.mtimeMs === st.mtimeMs;\n  }', 'return true;\n  }'],
  ['the newest hold is not the one that counts', 'let h = null; for (let i = holds.length - 1; i >= 0 && !h; i--)', 'let h = null; for (let i = 0; i < holds.length && !h; i++)'],
  ['the last message picks the wrong name', 'placeOf(v, m) > placeOf(v, best)', 'placeOf(v, m) < placeOf(v, best)'],
  ['a comms check is answered twice', "!(view.byRef.get(x.id) || []).some((a) => a.type === 'ack' && names.includes(a.from))", 'true'],
  ['a task\'s related messages ignore who may see them', '(view.byRef.get(t.id) || []).filter((m) => this._visible(who, m))', '(view.byRef.get(t.id) || [])'],
];

for (const [what, from, to] of BROKEN) {
  test(`the comparison catches a bus where ${what}`, async () => {
    const src = fs.readFileSync(BUS_SRC, 'utf8');
    assert.ok(src.includes(from), `the code this breaks has moved: ${from}`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-bus-broken-'));
    try {
      const { Bus: Broken } = await import(moduleCopy(dir, 'broken.mjs', src.replace(from, () => to)));
      let caught = null;
      for (let seed = 1; seed <= 60 && !caught; seed++) caught = await lockstep({ A: Broken, B: Oracle, seed, steps: 140 });
      assert.ok(caught, `no history told this broken bus from the reference: ${what}`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
