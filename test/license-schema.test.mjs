// SR-1.06 T1: one licence schema, checked by the one function every reader calls.
// install, activate, loadLicense and the merge gate all go through verifyLicense, so a licence that
// carries a field outside the schema, a malformed trial or org, or a signature that does not cover
// what it must is refused the same way everywhere. The trial licence format and the issue script's
// trial and extension flags are covered here too.
//
// The modules under test are loaded with a dynamic import inside try, so a tree that lacks a symbol
// fails the test that needs it as an assertion and never as a load error.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const loadErrors = {};
const load = async (name, rel) => {
  try { return await import(rel); } catch (e) { loadErrors[name] = e.message; return null; }
};
const L = await load('license', '../src/engine/license.mjs');
const C = await load('licensing', '../src/cli/licensing.mjs');
const M = await load('merge', '../src/engine/merge.mjs');
const K = await load('constants', './helpers/trial-constants.mjs');

const made = [];
const tmp = (p = 'sr106-') => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); made.push(d); return d; };
after(() => { for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const DAY = 86400e3;
const NOW = Date.parse('2026-11-01');
const at = (d) => Date.parse(d);

// A test vendor key. Licences are signed here with plain node:crypto over the bytes the spec
// describes (keys sorted at every level, `sig` left out), never with canonical() or signLicense().
const kp = crypto.generateKeyPairSync('ed25519');
const KEYS = { tk: kp.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
const PEM = kp.privateKey.export({ type: 'pkcs8', format: 'pem' });
const FOREIGN = crypto.generateKeyPairSync('ed25519');
const ser = (v) => (Array.isArray(v) ? `[${v.map(ser).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${ser(v[k])}`).join(',')}}` : JSON.stringify(v));
const signedBytes = (o) => Buffer.from(ser(Object.fromEntries(Object.keys(o).filter((k) => k !== 'sig').map((k) => [k, o[k]]))), 'utf8');
const signWith = (privateKey, o) => { const withKid = { ...o, kid: 'tk' }; return { ...withKid, sig: `ed25519:${crypto.sign(null, signedBytes(withKid), privateKey).toString('base64')}` }; };
const sign = (o) => signWith(kp.privateKey, o);
// A licence text that carries a key JSON.parse turns into an own property (__proto__ and the like), signed over its parsed form.
const signText = (fieldsText) => {
  const parsed = JSON.parse(fieldsText);
  const sig = `ed25519:${crypto.sign(null, signedBytes({ ...parsed, kid: 'tk' }), kp.privateKey).toString('base64')}`;
  return fieldsText.replace(/}\s*$/, `,"kid":"tk","sig":"${sig}"}`);
};

const BASE = { v: 1, lid: 'lic_schema01', tier: 'business', services: ['merge'], seats: 5, iat: '2026-10-01', exp: '2027-10-01', grace_days: 14 };
const TRIAL = { ...BASE, lid: 'lic_trial0001', iat: '2026-10-25', exp: '2026-11-08', grace_days: 7, trial: true, org: 'org_schema0001' };
const paid = (o = {}) => sign({ ...BASE, ...o });
const trial = (o = {}) => sign({ ...TRIAL, ...o });
const EMAILISH = 'x@example.invalid';

// Every assertion failure in this file is an ERR_ASSERTION: an unexpected throw is turned into one.
const t = (name, fn) => test(name, async () => {
  try { await fn(); } catch (e) {
    if (e && e.code === 'ERR_ASSERTION') throw e;
    assert.fail(`threw ${e && e.name}: ${e && e.message}`);
  }
});
const need = (obj, key, where) => assert.equal(typeof obj?.[key], 'function', `${where}.${key} exists${loadErrors[where] ? ` (${loadErrors[where]})` : ''}`);
const needAll = () => {
  for (const k of ['verifyLicense', 'loadLicense', 'licenseFile']) need(L, k, 'license');
  for (const k of ['installLicense', 'activateLicense', 'readTrialRecord', 'mergeAllowed']) need(C, k, 'licensing');
  for (const k of ['engineAllowed', 'resolveMerge']) need(M, k, 'merge');
};

const freshEnv = () => ({ ...process.env, MEMEV_CONFIG_DIR: path.join(tmp('sr106-cfg-'), 'memev') });
const trialsFile = (env) => path.join(env.MEMEV_CONFIG_DIR, 'trials.json');
const clockFile = (env) => path.join(env.MEMEV_CONFIG_DIR, 'license-clock.json');
const textOf = (lic) => (typeof lic === 'string' ? lic : JSON.stringify(lic));
const fileOf = (lic) => { const f = path.join(tmp('sr106-file-'), 'licence.json'); fs.writeFileSync(f, textOf(lic)); return f; };
const install = (env, lic, o = {}) => C.installLicense({ file: fileOf(lic), env, keys: KEYS, now: NOW, ...o });
const activate = (env, lic, o = {}) => C.activateLicense({ key: 'test-key-0001', endpoint: 'https://licence.test/activate', env, keys: KEYS, now: NOW, fetchImpl: async () => new Response(textOf(lic)), ...o });
const bothPaths = async (lic, o = {}) => ({ i: await install(freshEnv(), lic, o), a: await activate(freshEnv(), lic, o) });
const bytes = (f) => fs.readFileSync(f);

t('T1-c01: a licence with an unknown field is refused by install and by activate', async () => {
  needAll();
  const bad = paid({ plan: 'pro' });
  const { i, a } = await bothPaths(bad);
  assert.equal(i.ok, false, 'install refuses it');
  assert.equal(a.ok, false, 'activate refuses it');
  assert.match(i.reason, /plan/, 'install names the field');
  assert.match(a.reason, /plan/, 'activate names the field');
  const env = freshEnv(); await install(env, bad);
  assert.equal(fs.existsSync(L.licenseFile(env)), false, 'no licence file is written');
  const ok = await bothPaths(paid());
  assert.equal(ok.i.ok, true, 'the same licence without the extra field installs');
  assert.equal(ok.a.ok, true, 'and activates');
});

t('T1-c04: install refuses a licence carrying name, email or machine as activate does, and writes nothing', async () => {
  needAll();
  const extras = { name: 'A Name', email: EMAILISH, machine: 'host-1' };
  for (const [k, v] of Object.entries(extras)) {
    const bad = paid({ [k]: v });
    const env = freshEnv();
    const r = await install(env, bad);
    assert.equal(r.ok, false, `${k}: install refuses`);
    assert.match(r.reason, /carries more than a licence may/, `${k}: the reason says so`);
    assert.ok(r.reason.includes(k), `${k}: the reason names the field`);
    assert.doesNotMatch(r.reason, /signature/, `${k}: it is not a signature failure`);
    assert.equal(fs.existsSync(L.licenseFile(env)), false, `${k}: no file after the refusal`);
    const control = await install(freshEnv(), paid());
    assert.equal(control.ok, true, `${k}: the control installs`);
    const live = freshEnv();
    assert.equal((await install(live, paid())).ok, true);
    const before = bytes(L.licenseFile(live));
    const again = await install(live, bad);
    assert.equal(again.ok, false);
    assert.ok(before.equals(bytes(L.licenseFile(live))), `${k}: the installed licence is unchanged`);
    assert.equal(fs.existsSync(trialsFile(live)), false, `${k}: no trials.json appears`);
    const act = await activate(freshEnv(), bad);
    assert.equal(act.ok, false, `${k}: activate refuses`);
    assert.match(act.reason, /carries more than a licence may/, `${k}: activate gives the same kind of reason`);
  }
});

t('T1-c06: a trial extension installs and activates, and LICENSE_FIELDS lists the trial fields', async () => {
  needAll();
  for (const f of ['trial', 'org', 'trial_ext']) assert.ok(L.LICENSE_FIELDS?.includes(f), `LICENSE_FIELDS includes ${f}`);
  const first = trial({ org: 'org_ext0001' });
  const second = trial({ org: 'org_ext0001', lid: 'lic_trial0002', trial_ext: true });
  const env = freshEnv();
  assert.equal((await install(env, first)).ok, true, 'the first trial installs');
  const r = await install(env, second);
  assert.equal(r.ok, true, `the extension installs from file: ${r.reason}`);
  assert.equal(C.readTrialRecord(env).org_ext0001?.extended, true, 'the record shows the extension');
  const other = freshEnv();
  assert.equal((await install(other, first)).ok, true);
  const a = await activate(other, second);
  assert.equal(a.ok, true, `the extension activates by key: ${a.reason}`);
});

t('T1-c07: the schema check lives in verifyLicense, so a stored licence with an email is invalid to every reader', async () => {
  needAll();
  const env = freshEnv();
  fs.mkdirSync(env.MEMEV_CONFIG_DIR, { recursive: true });
  const bad = paid({ email: EMAILISH });
  fs.writeFileSync(L.licenseFile(env), JSON.stringify(bad));
  const l = L.loadLicense({ env, keys: KEYS, now: NOW });
  assert.equal(l.state, 'invalid');
  assert.match(l.reason, /email/, 'the reason names the field');
  assert.equal(C.mergeAllowed(JSON.parse(fs.readFileSync(L.licenseFile(env), 'utf8')), { keys: KEYS, now: NOW }), false, 'the merge gate refuses it');
  const good = freshEnv(); fs.mkdirSync(good.MEMEV_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(L.licenseFile(good), JSON.stringify(paid()));
  assert.equal(L.loadLicense({ env: good, keys: KEYS, now: NOW }).state, 'valid');
  assert.equal(C.mergeAllowed(paid(), { keys: KEYS, now: NOW }), true);
});

t('T1-c09: a key outside LICENSE_FIELDS is refused by install and by activate, and its name is in the reason', async () => {
  needAll();
  for (const k of ['customer_id', 'hostname', 'Email', 'note', 'relay', 'seats_extra']) {
    const bad = paid({ [k]: k === 'relay' ? { default_url: 'relay://127.0.0.1:9', default_domain: 'relay.test' } : 'x' });
    const ie = freshEnv(); const ae = freshEnv();
    const i = await install(ie, bad); const a = await activate(ae, bad);
    assert.equal(i.ok, false, `${k}: install refuses`);
    assert.equal(a.ok, false, `${k}: activate refuses`);
    assert.ok(i.reason.includes(k), `${k}: install names it`);
    assert.ok(a.reason.includes(k), `${k}: activate names it`);
    assert.equal(fs.existsSync(L.licenseFile(ie)), false, `${k}: install wrote nothing`);
    assert.equal(fs.existsSync(L.licenseFile(ae)), false, `${k}: activate wrote nothing`);
  }
  const ok = await bothPaths(paid({ connectors: 3 }));
  assert.equal(ok.i.ok, true); assert.equal(ok.a.ok, true);
});

const typeCases = [
  ['trial', 'true', true], ['trial', 1, true], ['trial_ext', 'no', false], ['org', 123, 'org_ok0001'], ['org', {}, 'org_ok0001'], ['org', EMAILISH, 'org_ok0001'], ['trial_ext', 1, true],
];
const typed = (field, value) => trial({ lid: 'lic_typed0001', ...(field === 'org' ? {} : { org: 'org_ok0001' }), [field]: value });

t('T1-c10: trial, trial_ext and org of the wrong type or shape make a signed licence invalid', async () => {
  needAll();
  for (const [field, bad] of typeCases.slice(0, 6)) {
    const lic = typed(field, bad);
    assert.equal(L.verifyLicense(lic, { keys: KEYS, now: NOW }).state, 'invalid', `${field}=${JSON.stringify(bad)} is invalid`);
    const { i, a } = await bothPaths(lic);
    assert.equal(i.ok, false, `${field}: install refuses`);
    assert.equal(a.ok, false, `${field}: activate refuses`);
  }
  const good = trial({ lid: 'lic_typed0002', org: 'org_ok0001' });
  assert.equal(L.verifyLicense(good, { keys: KEYS, now: NOW }).state, 'valid');
});

t('T1-c11: the header of license.mjs shows the licence, names the non-identity fields and lists every LICENSE_FIELDS entry', () => {
  need(L, 'verifyLicense', 'license');
  assert.ok(Array.isArray(L.LICENSE_FIELDS), 'LICENSE_FIELDS is exported');
  const src = fs.readFileSync(path.join(PKG, 'src', 'engine', 'license.mjs'), 'utf8');
  const head = src.slice(0, src.search(/^import /m)).split('\n').filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');
  const example = (head.match(/\{ "v"[\s\S]*?\}\n/) || [''])[0];
  const wrapper = (head.match(/\{ "license"[\s\S]*?\} \}/) || [''])[0];
  assert.ok(example.includes('"sig"'), 'the header has a licence example');
  assert.ok(wrapper.length > 0, 'the header has a separate wrapper example');
  const quoted = new Set([...example.matchAll(/"([a-z_]+)":/g)].map((m) => m[1]));
  assert.deepEqual([...quoted].sort(), [...L.LICENSE_FIELDS].sort(), 'the quoted keys of the licence example are the LICENSE_FIELDS');
  for (const w of ['license', 'relay', 'default_url', 'default_domain']) assert.ok(new RegExp(`"${w}"`).test(wrapper), `the wrapper example names ${w}`);
  for (const w of ['license', 'relay', 'default_url', 'default_domain']) assert.ok(!quoted.has(w), `${w} is not in the licence example`);
  const prose = head.replace(example, '').replace(wrapper, '');
  for (const f of ['trial', 'org', 'trial_ext']) assert.ok(new RegExp(`\\b${f}\\b`).test(prose), `the header names ${f} as a non-identity field`);
  for (const f of L.LICENSE_FIELDS) assert.ok(head.includes(f), `the header mentions ${f}`);
  assert.match(head, /unsigned/, 'the header says the relay object is unsigned');
});

t('T1-c13: a trial licence signed outside memev verifies, and every tamper is refused as a signature failure', async () => {
  needAll();
  const mine = sign({ ...TRIAL, trial_ext: true });
  assert.equal(L.verifyLicense(mine, { keys: KEYS, now: NOW }).state, 'valid');
  const both = await bothPaths(mine);
  assert.equal(both.i.ok, true, 'install accepts it'); assert.equal(both.a.ok, true, 'activate accepts it');
  const noExt = sign({ ...TRIAL });
  const ext = { ...mine };
  const dropExt = { ...ext }; delete dropExt.trial_ext;
  const tampers = {
    'trial flipped': { ...mine, trial: false },
    'org changed': { ...mine, org: 'org_schema0002' },
    'trial_ext removed': dropExt,
    'trial_ext added': { ...noExt, trial_ext: true },
    'exp a year later': { ...mine, exp: '2027-11-08' },
    'grace_days raised': { ...mine, grace_days: 90 },
  };
  for (const [what, lic] of Object.entries(tampers)) {
    const { i, a } = await bothPaths(lic);
    assert.equal(i.ok, false, `${what}: install refuses`);
    assert.equal(a.ok, false, `${what}: activate refuses`);
    assert.match(i.reason, /signature does not verify/, `${what}: install says the signature failed`);
    assert.match(a.reason, /signature does not verify/, `${what}: activate says the signature failed`);
    const env = freshEnv(); fs.mkdirSync(env.MEMEV_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(L.licenseFile(env), JSON.stringify(lic));
    assert.equal(L.loadLicense({ env, keys: KEYS, now: NOW }).state, 'invalid', `${what}: loadLicense says invalid`);
  }
});

t('T1-c16: a licence with an identity key is refused by verifyLicense and the merge gate calls no engine', () => {
  needAll();
  const provider = () => { const calls = []; return { calls, resolve(x) { calls.push(x); return { text: 'M\n' }; } }; };
  for (const k of ['email', 'name', 'customer_id', 'relay']) {
    const lic = paid({ [k]: k === 'relay' ? { default_url: 'relay://127.0.0.1:9' } : 'x' });
    const v = L.verifyLicense(lic, { keys: KEYS, now: NOW });
    assert.equal(v.state, 'invalid', `${k}: invalid`);
    assert.ok(v.reason.includes(k), `${k}: the reason names it`);
    assert.equal(M.engineAllowed(lic, { keys: KEYS, now: NOW }), false, `${k}: engineAllowed is false`);
    const p = provider();
    const r = M.resolveMerge({ a: 'A\n', b: 'B\n', base: 'x\n', license: lic, config: { merge: { provider: p } }, keys: KEYS, now: NOW });
    assert.equal(p.calls.length, 0, `${k}: the provider is not called`);
    assert.equal(r.keepBoth, true, `${k}: both versions are kept`);
  }
  const p = provider();
  const good = paid();
  assert.equal(M.engineAllowed(good, { keys: KEYS, now: NOW }), true);
  M.resolveMerge({ a: 'A\n', b: 'B\n', base: 'x\n', license: good, config: { merge: { provider: p } }, keys: KEYS, now: NOW });
  assert.equal(p.calls.length, 1, 'the clean licence calls the provider once');
});

t('T1-c17: a trial without org is invalid, and neither install nor activate writes a file', async () => {
  needAll();
  const noOrg = { ...TRIAL }; delete noOrg.org;
  const lic = sign(noOrg);
  assert.equal('org' in lic, false);
  const v = L.verifyLicense(lic, { keys: KEYS, now: NOW });
  assert.equal(v.state, 'invalid');
  assert.match(v.reason, /org/);
  for (const [what, run] of [['install', install], ['activate', activate]]) {
    const env = freshEnv();
    const r = await run(env, lic);
    assert.equal(r.ok, false, `${what} refuses it`);
    assert.equal(fs.existsSync(L.licenseFile(env)), false, `${what}: no license.json`);
    assert.equal(fs.existsSync(trialsFile(env)), false, `${what}: no trials.json`);
  }
});

t('T1-c20: each malformed trial field is refused by name, and the corrected licence is accepted', async () => {
  needAll();
  for (const [field, bad, good] of typeCases) {
    const badLic = typed(field, bad);
    const v = L.verifyLicense(badLic, { keys: KEYS, now: NOW });
    assert.equal(v.state, 'invalid', `${field}: verify refuses`);
    assert.ok(v.reason.includes(field), `${field}: verify names the field`);
    assert.doesNotMatch(v.reason, /signature/, `${field}: it is not a signature failure`);
    const { i, a } = await bothPaths(badLic);
    for (const [what, r] of [['install', i], ['activate', a]]) {
      assert.equal(r.ok, false, `${field}: ${what} refuses`);
      assert.ok(r.reason.includes(field), `${field}: ${what} names the field`);
      assert.doesNotMatch(r.reason, /signature/, `${field}: ${what} reason is not a signature failure`);
    }
    const goodLic = typed(field, good);
    assert.equal(L.verifyLicense(goodLic, { keys: KEYS, now: NOW }).state, 'valid', `${field}: corrected verifies`);
    const ok = await bothPaths(goodLic);
    assert.equal(ok.i.ok, true, `${field}: corrected installs`);
    assert.equal(ok.a.ok, true, `${field}: corrected activates`);
  }
});

t('T1-c24: keys that name Object.prototype members are unknown fields, and LICENSE_FIELDS is the schema', async () => {
  needAll();
  for (const k of ['__proto__', 'constructor', 'toString']) {
    const text = signText(`{${Object.entries(BASE).map(([a, b]) => `${JSON.stringify(a)}:${JSON.stringify(b)}`).join(',')},${JSON.stringify(k)}:"x"}`);
    const lic = JSON.parse(text);
    assert.ok(Object.keys(lic).includes(k), `${k} is an own key of the parsed licence`);
    const v = L.verifyLicense(lic, { keys: KEYS, now: NOW });
    assert.equal(v.state, 'invalid', `${k}: verify refuses`);
    assert.ok(v.reason.includes(k), `${k}: verify names it`);
    const { i, a } = await bothPaths(text);
    assert.equal(i.ok, false, `${k}: install refuses`); assert.equal(a.ok, false, `${k}: activate refuses`);
    assert.ok(i.reason.includes(k), `${k}: install names it`); assert.ok(a.reason.includes(k), `${k}: activate names it`);
  }
  assert.deepEqual([...L.LICENSE_FIELDS].sort(), ['v', 'lid', 'tier', 'services', 'seats', 'connectors', 'iat', 'exp', 'grace_days', 'kid', 'sig', 'trial', 'org', 'trial_ext'].sort());
});

t('T1-c31: an org that is a prototype member name, empty or null is refused, and no prototype is reached', async () => {
  needAll();
  for (const org of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '', null]) {
    const lic = trial({ org });
    const v = L.verifyLicense(lic, { keys: KEYS, now: NOW });
    assert.equal(v.state, 'invalid', `org ${JSON.stringify(org)}: invalid`);
    assert.match(v.reason, /org/, `org ${JSON.stringify(org)}: the reason names org`);
    for (const [what, run] of [['install', install], ['activate', activate]]) {
      const env = freshEnv();
      const r = await run(env, lic);
      assert.equal(r.ok, false, `org ${JSON.stringify(org)}: ${what} refuses`);
      assert.equal(fs.existsSync(L.licenseFile(env)), false, `${what}: no license.json`);
      assert.equal(fs.existsSync(trialsFile(env)), false, `${what}: no trials.json`);
    }
  }
  assert.equal(({}).ended, undefined); assert.equal(({}).converted_to, undefined); assert.equal(({}).lid, undefined);
  assert.equal(L.verifyLicense(trial({ org: 'org_a'.padEnd(4 + 4, 'b') }), { keys: KEYS, now: NOW }).state, 'valid', 'a plain org id is accepted');
  assert.equal(L.verifyLicense(trial({ org: 'org_abcd' }), { keys: KEYS, now: NOW }).state, 'valid', 'the shortest org (4 characters after org_) is accepted');
  assert.equal(L.verifyLicense(trial({ org: 'org_abc' }), { keys: KEYS, now: NOW }).state, 'invalid', 'one character less is not');
  assert.equal(L.verifyLicense(trial({ org: `org_${'a'.repeat(64)}` }), { keys: KEYS, now: NOW }).state, 'valid', '64 characters are accepted');
  assert.equal(L.verifyLicense(trial({ org: `org_${'a'.repeat(65)}` }), { keys: KEYS, now: NOW }).state, 'invalid', '65 are not');
});

t('T1-c39: the clock floor stops a wound-back clock from reviving a lapsed trial, and loadLicense keeps it', () => {
  needAll();
  const lic = trial({ iat: '2026-10-01', exp: '2026-10-22', grace_days: 7 });
  assert.equal(L.verifyLicense(lic, { keys: KEYS, now: NOW }).state, 'expired', 'three days past grace it reads expired');
  const early = NOW - 12 * DAY;
  assert.equal(L.verifyLicense(lic, { keys: KEYS, now: early }).state, 'valid', 'with no floor the earlier now reads valid');
  assert.equal(L.verifyLicense(lic, { keys: KEYS, now: early, floor: NOW }).state, 'expired', 'with the floor it reads expired');
  assert.equal(M.engineAllowed(lic, { keys: KEYS, now: early }), true, 'the gate allows it with no floor');
  assert.equal(M.engineAllowed(lic, { keys: KEYS, now: early, floor: NOW }), false, 'the gate refuses it with the floor');
  const env = freshEnv(); fs.mkdirSync(env.MEMEV_CONFIG_DIR, { recursive: true });
  const edge = paid({ lid: 'lic_edge00001', exp: '2026-10-31', grace_days: 0 });
  fs.writeFileSync(L.licenseFile(env), JSON.stringify(edge));
  assert.equal(L.loadLicense({ env, keys: KEYS, now: NOW }).state, 'expired');
  assert.equal(JSON.parse(fs.readFileSync(clockFile(env), 'utf8')).floor, NOW, 'the clock file holds now');
  assert.equal(L.loadLicense({ env, keys: KEYS, now: NOW - DAY }).state, 'expired', 'a day earlier still reads expired');
  assert.equal(JSON.parse(fs.readFileSync(clockFile(env), 'utf8')).floor, NOW, 'the clock file still holds the real now');
  assert.equal(L.loadLicense({ env, keys: KEYS, now: NOW + DAY }).state, 'expired');
  assert.equal(JSON.parse(fs.readFileSync(clockFile(env), 'utf8')).floor, NOW + DAY, 'and it rises with a later now');
});

// ---- the trial licence format, kept from the first trial work and rewritten to the signed spec ----

t('the trial states run valid, grace, expired, and verifyLicense returns the trial fields', () => {
  need(L, 'verifyLicense', 'license');
  const lic = trial({ iat: '2026-01-01', exp: '2026-01-15', grace_days: 7 });
  assert.equal(L.verifyLicense(lic, { keys: KEYS, now: at('2026-01-10') }).state, 'valid');
  assert.equal(L.verifyLicense(lic, { keys: KEYS, now: at('2026-01-18') }).state, 'grace');
  assert.equal(L.verifyLicense(lic, { keys: KEYS, now: at('2026-01-25') }).state, 'expired');
  const v = L.verifyLicense(lic, { keys: KEYS, now: at('2026-01-10') });
  assert.equal(v.trial, true); assert.equal(v.org, 'org_schema0001'); assert.equal('trial_ext' in v, false);
  const ext = L.verifyLicense(trial({ trial_ext: true }), { keys: KEYS, now: NOW });
  assert.equal(ext.trial_ext, true, 'verifyLicense returns trial_ext');
  assert.equal(L.verifyLicense(foreign(), { keys: KEYS, now: NOW }).state, 'invalid', 'a trial signed by another key is invalid');
});

t('a licence without trial fields reads exactly as before, with or without a floor', () => {
  need(L, 'verifyLicense', 'license');
  const plain = paid({ lid: 'lic_plain0001', services: ['sync'], iat: '2026-01-01', exp: '2026-06-01' });
  const p = L.verifyLicense(plain, { keys: KEYS, now: at('2026-02-01') });
  assert.equal(p.state, 'valid');
  for (const k of ['trial', 'trial_ext', 'org']) assert.equal(k in p, false, `no ${k} on a licence that has none`);
  const w = L.verifyLicense(plain, { keys: KEYS, now: at('2026-02-01'), floor: at('2026-02-01') });
  assert.equal(w.state, p.state); assert.equal(w.reason, p.reason);
  const lower = L.verifyLicense(plain, { keys: KEYS, now: at('2026-02-01'), floor: at('2026-01-01') });
  assert.equal(lower.reason, p.reason, 'a floor earlier than now changes nothing');
  assert.equal(L.verifyLicense(paid({ connectors: 3 }), { keys: KEYS, now: NOW }).state, 'valid', 'a licence with only LICENSE_FIELDS keys is valid');
});

t('a refused licence leaves the installed licence and the trial record as they were', async () => {
  needAll();
  const env = freshEnv();
  assert.equal((await install(env, trial({ org: 'org_keep0001' }))).ok, true);
  const lic = bytes(L.licenseFile(env)); const rec = bytes(trialsFile(env));
  for (const bad of [paid({ email: EMAILISH }), typed('trial', 'true'), typed('org', 123), sign({ ...TRIAL, org: 'org_keep0002', trial_ext: 'yes' })]) {
    assert.equal((await install(env, bad)).ok, false, 'install refuses it');
    assert.equal((await activate(env, bad)).ok, false, 'activate refuses it');
    assert.ok(lic.equals(bytes(L.licenseFile(env))), 'the installed licence is unchanged');
    assert.ok(rec.equals(bytes(trialsFile(env))), 'the trial record is unchanged');
  }
});

t('with no licence installed loadLicense reads the free tier and records no clock', () => {
  need(L, 'loadLicense', 'license');
  const env = freshEnv();
  assert.equal(L.loadLicense({ env, keys: KEYS, now: NOW }).state, 'none');
  assert.equal(fs.existsSync(clockFile(env)), false, 'no clock file for the free tier');
});

const foreign = () => signWith(FOREIGN.privateKey, TRIAL);

const issueKey = () => { const f = path.join(tmp('sr106-key-'), 'k.pem'); fs.writeFileSync(f, PEM, { mode: 0o600 }); return f; };
const issue = (...a) => spawnSync(process.execPath, [path.join(PKG, 'scripts', 'license', 'issue.mjs'), ...a], { encoding: 'utf8' });

t('issue.mjs --trial and --extension refuse what a trial may not be', () => {
  assert.equal(K?.TRIAL_DAYS, 14, `the trial length constant exists${loadErrors.constants ? ` (${loadErrors.constants})` : ''}`);
  assert.equal(K?.TRIAL_EXT_DAYS, 14);
  const k = issueKey();
  assert.match(issue('--key', k, '--trial', '--tier', 'personal', '--seats', '5', '--org', 'org_acme0001').stderr, /Personal tiers have no trial/);
  assert.match(issue('--key', k, '--trial', '--seats', '5', '--org', 'org_acme0001', '--exp', 'none').stderr, /do not pass --exp/);
  assert.match(issue('--key', k, '--trial', '--org', 'org_acme0001').stderr, /--seats/);
  assert.match(issue('--key', k, '--extension', '--seats', '5', '--org', 'org_acme0001').stderr, /--extension needs --trial/);
  assert.match(issue('--key', k, '--trial', '--extension', '--seats', '5', '--org', 'org_acme0001', '--days', '30').stderr, /do not pass --days/);
  assert.match(issue('--key', k, '--trial', '--tier', 'corporate', '--seats', '5', '--org', 'org_acme0001').stderr, /not the vendor key/, 'a valid trial request gets as far as the key check');
});

t('issue.mjs takes the same org ids as the schema and keeps a one-extension ledger', () => {
  const k = issueKey();
  for (const bad of ['acme.com', 'myhost', 'org_abc', `org_${'a'.repeat(65)}`, EMAILISH]) {
    assert.match(issue('--key', k, '--trial', '--seats', '5', '--org', bad).stderr, /--org/, `${bad} is refused`);
  }
  for (const good of ['org_abcd', `org_${'a'.repeat(64)}`]) {
    assert.match(issue('--key', k, '--trial', '--seats', '5', '--org', good).stderr, /not the vendor key/, `${good} is accepted`);
  }
  const ledger = path.join(tmp('sr106-ledger-'), 'ext.json');
  fs.writeFileSync(ledger, JSON.stringify({ org_acme0001: { lid: 'lic_prev', iat: '2026-01-01', exp: '2026-01-15' } }));
  assert.match(issue('--key', k, '--trial', '--extension', '--seats', '5', '--org', 'org_acme0001', '--ledger', ledger).stderr, /already been issued/);
  assert.match(issue('--key', k, '--trial', '--extension', '--seats', '5', '--org', 'org_other0001', '--ledger', ledger).stderr, /not the vendor key/, 'another org may still take its extension');
});

t('the issue script copy and the changelog note pass the writing check', () => {
  const src = fs.readFileSync(path.join(PKG, 'scripts', 'license', 'issue.mjs'), 'utf8');
  assert.match(src, /--trial/, 'the script has the trial flag');
  const noteFile = path.join(PKG, 'changelog.d', 'SR-1.06.md');
  assert.ok(fs.existsSync(noteFile), 'the changelog note exists');
  const note = fs.readFileSync(noteFile, 'utf8');
  const strings = [...src.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map((m) => (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ''));
  const emdash = new RegExp(String.fromCharCode(0x2014));
  for (const s of [...strings, note]) {
    assert.doesNotMatch(s, /\b(seamless|robust|powerful|leverage|unlock|cutting[- ]edge)\b/i, `hype in: ${s}`);
    assert.doesNotMatch(s, /not just .+ but\b/i, `not-just framing in: ${s}`);
    assert.doesNotMatch(s, /\p{Extended_Pictographic}/u, `emoji in: ${s}`);
    assert.doesNotMatch(s, /!/, `exclamation in: ${s}`);
    assert.doesNotMatch(s, emdash, `em-dash in: ${s}`);
    assert.doesNotMatch(s, /\bcertified\b/i, `certified in: ${s}`);
  }
});
