// SR-1.36 T7: every doctor check that can warn or fail says how to fix it, automatically or by hand, and names the apps
// it concerns; doctor --fix --safe-only runs only the fixes marked not destructive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, tmpdir, PKG } from './helpers/tmp.mjs';

const load = async () => {
  const m = await import('../src/cli/doctor.mjs');
  assert.equal(typeof m.explain, 'function', 'doctor exports explain(checks)');
  assert.equal(typeof m.applyFixes, 'function', 'doctor exports applyFixes(checks, opts)');
  return m;
};

test('T7-c01: over a fixture vault with every check forced to warn, each warn or fail check has fix.desc or a manual sentence', async () => {
  const m = await load();
  const { root, v: vault } = newVault();
  const home = tmpdir('doctor-home-');
  const env = { HOME: home, MEMEV_CONFIG_DIR: path.join(home, '.config', 'memev'), XDG_CONFIG_HOME: path.join(home, '.config') };
  // one connected app whose entry is gone and which has no seat: both checks name it
  fs.mkdirSync(env.MEMEV_CONFIG_DIR, { recursive: true });
  const f = path.join(home, '.cursor', 'mcp.json'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, '{}');
  fs.writeFileSync(path.join(env.MEMEV_CONFIG_DIR, 'clients-state.json'), JSON.stringify({ connected: { cursor: {} }, files: { [f]: { client: 'cursor' } } }));
  try {
    const checks = m.fileChecks({ root, env, vault });
    assert.ok(checks.length >= 15);
    const forced = m.explain(checks.map((c) => ({ ...c, status: 'warn', fix: c.fix })));
    for (const c of forced) assert.ok(c.fix?.desc || c.fix?.manual, `${c.id} says how to fix it`);
    for (const st of ['fail', 'warn']) for (const c of m.explain(checks.map((x) => ({ ...x, status: st, fix: null })))) assert.ok(c.fix.manual, `${c.id} (${st}) has a sentence`);
    assert.equal(m.explain([{ id: 'x', status: 'ok', fix: null }])[0].fix, null, 'an ok check needs nothing');
    assert.match(m.explain([{ id: 'no-such-check', status: 'warn', fix: null }])[0].fix.manual, /doctor --bundle/);
    const kept = { desc: 'own fix', destructive: false };
    assert.equal(m.explain([{ id: 'git', status: 'fail', fix: kept }])[0].fix, kept, 'a check with a fix keeps it');
    // every check the doctor can make has its sentence, not only the ones this vault produced
    const ids = [...fs.readFileSync(path.join(PKG, 'src', 'cli', 'doctor.mjs'), 'utf8').matchAll(/C\('([a-z0-9-]+)'/g)].map((x) => x[1]);
    for (const id of new Set(ids)) assert.ok(m.MANUAL[id], `MANUAL has ${id}`);
    const apps = checks.find((c) => c.id === 'apps'); const seats = checks.find((c) => c.id === 'bus-seats');
    assert.deepEqual(apps.related, ['cursor'], 'the apps check names the app');
    assert.deepEqual(seats.related, ['cursor'], 'the seats check names the app');
  } finally { vault.close(); }
});

test('T7-c02: doctor --fix --safe-only never runs a fix marked destructive, and reports each one', async () => {
  const { applyFixes } = await load();
  const ran = [];
  const mk = (id, fix) => ({ id, title: id, status: 'warn', fix });
  const checks = [
    mk('safe', { desc: 'safe one', destructive: false, run: () => ran.push('safe') }),
    mk('risky', { desc: 'risky one', destructive: true, run: () => ran.push('risky') }),
    mk('unmarked', { desc: 'unmarked', run: () => ran.push('unmarked') }),
    mk('hand', { manual: 'do it by hand' }),
    { id: 'fine', title: 'fine', status: 'ok', fix: { desc: 'n/a', destructive: false, run: () => ran.push('fine') } },
  ];
  const apply = async (c) => c.fix.run();
  const r = await applyFixes(checks, { safeOnly: true, yes: true, ask: async () => true, apply });
  assert.deepEqual(ran, ['safe'], 'only the safe fix ran, even with --yes');
  assert.deepEqual(r.tried.map((c) => c.id), ['safe']);
  assert.deepEqual(r.skipped.map((s) => [s.check.id, s.why]), [['risky', 'destructive'], ['unmarked', 'destructive'], ['hand', 'by hand']]);
  // without --safe-only a destructive fix asks first, runs on a yes or --yes, and is skipped with no way to ask
  ran.length = 0;
  await applyFixes(checks, { ask: async () => false, apply });
  assert.deepEqual(ran, ['safe', 'unmarked']);
  ran.length = 0;
  await applyFixes(checks, { ask: async () => true, apply });
  assert.deepEqual(ran, ['safe', 'risky', 'unmarked']);
  ran.length = 0;
  const r2 = await applyFixes(checks, { yes: true, apply });
  assert.deepEqual(ran, ['safe', 'risky', 'unmarked']); assert.equal(r2.tried.length, 3);
  ran.length = 0;
  const r3 = await applyFixes(checks, { apply });
  assert.deepEqual(ran, ['safe', 'unmarked']); assert.deepEqual(r3.skipped.map((s) => s.why), ['needs confirmation', 'by hand']);
  // a fix that throws is reported and the rest still run
  const r4 = await applyFixes([mk('boom', { desc: 'b', destructive: false, cmd: 'x' }), checks[0]], { apply: async (c) => { if (c.id === 'boom') throw new Error('no'); return c.fix.run(); } });
  assert.deepEqual(r4.tried.map((c) => c.id), ['safe']);
});
