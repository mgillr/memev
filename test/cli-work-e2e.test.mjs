// PG-19.1 (WP19-02): the work command run through bin/memev.mjs against a real project store. The test spawns the CLI, reads its real
// output and exit code, and imports neither runWork nor openStore and passes no store. Only the work status command is run.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, mcpClient } from './helpers/cli.mjs';
import crypto from 'node:crypto';
import { cleanup, PKG } from './helpers/tmp.mjs';
import { Vault } from '../src/engine/vault.mjs';
import { addEntity, link } from '../src/engine/relationships.mjs';
after(cleanup);

test('WP19-02 AC01: the end-to-end test fails before and passes after: memev work status prints a real project from the daemon', async () => {
  const sb = sandbox();
  try {
    let init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    for (let i = 0; i < 2 && init.code !== 0 && /did not start/.test(init.out + init.err); i++) init = sb.run(['start']); // a slow first start
    assert.equal(init.code, 0, init.err + init.out);
    const c = mcpClient(sb, 'e2e-client');
    const planned = await c.tool('memev_task_plan', { project: 'shop', tasks: [{ id: 'A', title: 'build the cart', artifacts: ['src/cart.js'] }, { id: 'B', title: 'write the copy', artifacts: ['src/copy.js'] }] });
    assert.ok(!planned.isError, JSON.stringify(planned));
    await c.close();
    const r = sb.run(['work', 'status', 'shop']);
    assert.equal(r.code, 0, r.err + r.out);
    assert.match(r.out, /shop: /);
    assert.match(r.out, /build the cart/);
    assert.match(r.out, /write the copy/);
    const j = sb.run(['work', 'status', 'shop', '--json']);
    assert.equal(j.code, 0, j.err);
    const data = JSON.parse(j.out);
    assert.equal(data.project, 'shop');
    assert.deepEqual(Object.keys(data.tasks).sort(), ['A', 'B']);
    const none = sb.run(['work', 'status', 'nothing-here']);
    assert.equal(none.code, 1);
    assert.match(none.err, /no project nothing-here/);
  } finally { sb.stop(); }
});

test('WP19-02 AC02: the test spawns the CLI and imports neither runWork nor openStore', () => {
  const src = fs.readFileSync(path.join(PKG, 'test', 'cli-work-e2e.test.mjs'), 'utf8');
  const imports = src.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n');
  assert.doesNotMatch(imports, /work\.mjs|work-store\.mjs|runWork|openStore/);
  assert.match(src, /sb\.run\(\['work', 'status'/);
});

// ---- memev work impact opens a vault in the CLI process beside the running daemon: it must leave the disk exactly as it was

// Every file under the given folders: its size, its modification time and its content hash, and the folder names, so an added or a
// removed file shows too.
function snapshot(...dirs) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { out[`${f}/`] = 'dir'; walk(f); continue; }
      let st; try { st = fs.statSync(f); } catch { continue; } // a file that went away between the listing and the stat
      out[f] = { size: st.size, mtimeMs: st.mtimeMs, sha: crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') };
    }
  };
  for (const d of dirs) if (fs.existsSync(d)) walk(d);
  return out;
}
const diff = (a, b) => ({
  added: Object.keys(b).filter((k) => !(k in a)),
  removed: Object.keys(a).filter((k) => !(k in b)),
  changed: Object.keys(a).filter((k) => k in b && JSON.stringify(a[k]) !== JSON.stringify(b[k])),
});
const quiet = (d) => d.added.length + d.removed.length + d.changed.length === 0;
const settle = async (dirs) => { // the daemon's own start-up writes finish; wait until two snapshots a moment apart agree
  let prev = snapshot(...dirs);
  for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 400)); const now = snapshot(...dirs); if (quiet(diff(prev, now))) return now; prev = now; }
  return prev;
};
const ref = (kind, id) => ({ kind, id });

test('WP19-03 AC01: memev work impact beside a running daemon adds, removes and changes no file, and the daemon stays healthy', async () => {
  const sb = sandbox();
  try {
    let init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
    for (let i = 0; i < 2 && init.code !== 0 && /did not start/.test(init.out + init.err); i++) init = sb.run(['start']); // a slow first start
    assert.equal(init.code, 0, init.err + init.out);
    const c = mcpClient(sb, 'e2e-client');
    await c.tool('memev_task_plan', { project: 'shop', tasks: [{ id: 'A', title: 'build the cart', artifacts: ['src/cart.js'] }, { id: 'B', title: 'write the copy', artifacts: ['src/copy.js'] }] });
    await c.close();
    // give the project a relationship graph while the daemon is stopped, so there is something for impact to list
    sb.stop();
    const v = new Vault(sb.root, { git: false }).open();
    const store = v.projectStore('shop');
    for (const [kind, id] of [['milestone', 'M1'], ['deliverable', 'D1'], ['work_package', 'W1']]) addEntity(store, kind, { title: `${kind} ${id}` }, id);
    for (const [t, f, to] of [['scope-to-milestone', ref('scope', 'S1'), ref('milestone', 'M1')], ['milestone-to-deliverable', ref('milestone', 'M1'), ref('deliverable', 'D1')], ['deliverable-to-work-package', ref('deliverable', 'D1'), ref('work_package', 'W1')], ['work-package-to-task', ref('work_package', 'W1'), ref('task', 'A')]]) assert.equal(link(store, { link_type: t, from: f, to, actor: 'planner' }).ok, true);
    v.close();
    let start = sb.run(['start']);
    for (let i = 0; i < 2 && start.code !== 0; i++) start = sb.run(['start']);
    assert.equal(start.code, 0, start.err + start.out);
    const dirs = [sb.root, path.join(sb.home, '.config')];
    const before = await settle(dirs);
    assert.ok(Object.keys(before).some((k) => k.includes(`${path.sep}projects${path.sep}shop${path.sep}`)), 'the project store is among the files watched');
    // the daemon alone, over the same stretch of time, is the noise floor of this check
    await new Promise((r) => setTimeout(r, 1500));
    const floor = diff(before, snapshot(...dirs));
    assert.ok(quiet(floor), `the daemon is quiet by itself: ${JSON.stringify(floor)}`);

    const text = sb.run(['work', 'impact', 'S1', '--project', 'shop']);
    assert.equal(text.code, 0, text.err + text.out);
    assert.match(text.out, /task A/);
    const json = sb.run(['work', 'impact', 'S1', '--project', 'shop', '--json']);
    assert.equal(json.code, 0, json.err);
    assert.ok(JSON.parse(json.out).dependents.some((d) => d.id === 'A'));
    const missing = sb.run(['work', 'impact', 'S1', '--project', 'nope']);
    assert.equal(missing.code, 1);

    const after = snapshot(...dirs);
    const d = diff(before, after);
    assert.deepEqual(d, { added: [], removed: [], changed: [] }, `memev work impact touched the disk: ${JSON.stringify(d)}`);
    const h = await fetch(`http://127.0.0.1:${sb.port}/healthz`);
    assert.equal((await h.json()).ok, true, 'the daemon is still healthy');
  } finally { sb.stop(); }
});
