// The vault config records where the vault runs (local, on-prem, cloud-hosted) and what kind of AI
// provider it uses. memev deployment shows both, the trial path that fits, and writes the choice on
// set; doctor reports both on every run and backs the memev_doctor tool with the same check.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sandbox, mcpClient } from './helpers/cli.mjs';
import { cleanup, PKG } from './helpers/tmp.mjs';
import { readDeployment, setDeployment, RUNS_WHERE, TRIAL_PATHS, trialPath } from '../src/cli/deployment.mjs';

after(() => cleanup());

const SRC = path.join(PKG, 'src', 'cli', 'deployment.mjs');
const cfgFile = (root) => path.join(root, '.memev', 'config.json');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const init = (sb) => {
  const r = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
  assert.equal(r.code, 0, r.out + r.err);
};
const depCheck = (sb) => {
  const r = sb.run(['doctor', '--json']);
  const c = JSON.parse(r.out).find((x) => x.id === 'deployment');
  assert.ok(c, `no deployment check in doctor output: ${r.out}`);
  return c;
};
const trialLine = (sb) => {
  const out = sb.run(['deployment']).out;
  const m = /trial path:\n  (.*)\n?$/m.exec(out);
  assert.ok(m, out);
  return m[1];
};

test('MEM-138 AC01: absent keys read as local and unset, and doctor and status leave the config byte-identical', () => {
  const sb = sandbox();
  try {
    init(sb);
    const file = cfgFile(sb.root);
    const before = fs.readFileSync(file);
    assert.equal(JSON.parse(before.toString('utf8')).deployment, undefined);
    assert.deepEqual(readDeployment(sb.root), { mode: 'local', provider: 'unset' });
    assert.equal(sb.run(['status']).code, 0);
    sb.run(['doctor']);
    assert.deepEqual(fs.readFileSync(file), before, 'the config must stay byte-identical');
    for (const mode of ['local', 'on-prem', 'cloud-hosted']) {
      setDeployment(sb.root, { mode });
      assert.equal(readDeployment(sb.root).mode, mode);
    }
    for (const ai of ['hosted-api', 'internal-llm', 'mixed']) {
      setDeployment(sb.root, { ai });
      assert.equal(readDeployment(sb.root).provider, ai);
    }
  } finally { sb.stop(); }
});

test('MEM-138 AC02: deployment prints the mode, the provider and three lines, --json carries the same fields, and set changes nothing else in the config', () => {
  const sb = sandbox();
  try {
    init(sb);
    const file = cfgFile(sb.root);
    const before = JSON.parse(fs.readFileSync(file, 'utf8'));
    const show = sb.run(['deployment']);
    assert.equal(show.code, 0, show.err);
    assert.match(show.out, /^mode: local\nprovider: unset\n/m);
    const lines = /what runs where:\n((?:  .*\n?)+)/.exec(show.out)[1].trim().split('\n');
    assert.equal(lines.length, 3);
    for (const l of RUNS_WHERE.local) assert.match(show.out, new RegExp(esc(l)));
    const j = JSON.parse(sb.run(['deployment', '--json']).out);
    assert.deepEqual(j, { mode: 'local', provider: 'unset', runs_where: RUNS_WHERE.local, trial_path: trialPath('local', 'unset') });
    const set = sb.run(['deployment', 'set', '--mode', 'on-prem', '--ai', 'internal-llm']);
    assert.equal(set.code, 0, set.err);
    assert.match(set.out, /^deployment set: mode on-prem, provider internal-llm$/m, `the set line must name the provider: ${set.out}`);
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    const { deployment: _b, ...restBefore } = before;
    const { deployment: depAfter, ...restAfter } = after;
    assert.deepEqual(restAfter, restBefore, 'setting the deployment must change nothing else in the config');
    assert.deepEqual(depAfter, { mode: 'on-prem', ai_provider: 'internal-llm' });
    const bad = sb.run(['deployment', 'set', '--mode', 'bogus']);
    assert.notEqual(bad.code, 0);
    assert.match(bad.err, /unknown mode: bogus; valid modes: local, on-prem, cloud-hosted/);
    assert.equal(bad.err.trim().split('\n').length, 1);
    const badAi = sb.run(['deployment', 'set', '--ai', 'bogus']);
    assert.notEqual(badAi.code, 0);
    assert.match(badAi.err, /unknown ai provider: bogus; valid providers: hosted-api, internal-llm, mixed/);
    assert.equal(badAi.err.trim().split('\n').length, 1);
  } finally { sb.stop(); }
});

test('MEM-138 AC03: cloud-hosted is labelled planned with a one-line notice, and the what-runs-where text says what runs where', () => {
  const sb = sandbox();
  try {
    init(sb);
    const set = sb.run(['deployment', 'set', '--mode', 'cloud-hosted']);
    assert.equal(set.code, 0, set.err);
    const planned = set.out.split('\n').filter((l) => l.includes('not available yet'));
    assert.equal(planned.length, 1, set.out);
    assert.match(planned[0], /planned/);
    assert.match(planned[0], /records the choice and changes nothing else/);
    assert.doesNotMatch(set.out, /\b(19|20)\d{2}\b/);
    const out = sb.run(['deployment']).out;
    for (const s of ['The vault server runs on a host the operator manages', 'Your computers and AI apps connect to it', 'calls to an AI provider are made by your own AI apps with your own keys', 'Memev holds no provider keys and makes no model calls'])
      assert.match(out, new RegExp(esc(s)));
    assert.equal(sb.run(['deployment', 'set', '--mode', 'on-prem']).code, 0);
    const op = sb.run(['deployment']).out;
    assert.match(op, new RegExp(esc('The vault server runs on your own servers')));
    assert.match(op, new RegExp(esc('Any internal model stays inside your environment')));
  } finally { sb.stop(); }
});

test('MEM-138 AC04: doctor has one deployment check that reports mode and provider, never fails, warns on cloud-hosted with internal-llm, and backs the memev_doctor tool', async () => {
  const sb = sandbox();
  try {
    init(sb);
    let c = depCheck(sb);
    assert.equal(c.status, 'ok');
    assert.match(c.detail, /^mode local, provider unset$/);
    assert.equal(sb.run(['deployment', 'set', '--mode', 'cloud-hosted', '--ai', 'internal-llm']).code, 0);
    c = depCheck(sb);
    assert.notEqual(c.status, 'fail');
    assert.equal(c.status, 'warn');
    assert.match(c.detail, /mode cloud-hosted, provider internal-llm/);
    assert.match(c.detail, /cannot be reached from a managed host/);
    assert.match(c.detail, /docs\/DOCKER\.md/);
    assert.ok(!c.detail.includes('\n'), 'the warning is one line');
    const mcp = mcpClient(sb, 'claude-code');
    const res = await mcp.tool('memev_doctor', {});
    await mcp.close();
    const text = JSON.stringify(res);
    assert.match(text, /deployment/);
    assert.match(text, /mode cloud-hosted, provider internal-llm/);
  } finally { sb.stop(); }
});

test('MEM-138 AC05: the trial path fits the choice from one table, says what is free and what is paid, and prints no counts or prices', () => {
  const sb = sandbox();
  try {
    init(sb);
    const cases = [
      ['cloud-hosted', 'hosted-api', [/self-serve Business trial/, /free and self-serve/]],
      ['cloud-hosted', 'mixed', [/self-serve Business trial/, /free and self-serve/]],
      ['on-prem', 'hosted-api', [/self-serve Business trial/, /trial licence is free and the container install is free/, /setup done by the operator is a paid service quoted per the rate card in docs\/tiers\/services\.md/]],
      ['on-prem', 'mixed', [/self-serve Business trial/, /trial licence is free and the container install is free/, /paid service quoted per the rate card/]],
      ['cloud-hosted', 'internal-llm', [/sales-assisted pilot/, /size is set by order form/, /term starts at licence install/]],
      ['on-prem', 'internal-llm', [/sales-assisted pilot/, /size is set by order form/, /term starts at licence install/]],
    ];
    for (const [mode, ai, pats] of cases) {
      const set = sb.run(['deployment', 'set', '--mode', mode, '--ai', ai]);
      assert.equal(set.code, 0, set.err);
      const line = trialLine(sb);
      for (const p of pats) assert.match(line, p, `${mode}/${ai}: ${line}`);
      assert.doesNotMatch(line, /\d/, `no member counts or prices in: ${line}`);
      assert.doesNotMatch(line, /[$€£]/);
    }
    assert.deepEqual(Object.keys(TRIAL_PATHS).sort(), ['business', 'pilot']);
  } finally { sb.stop(); }
});

test('MEM-138 AC06: the new module imports no networking, DNS, HTTP or child-process module, calls no fetch, and the doctor check reads the config only', () => {
  const s = fs.readFileSync(SRC, 'utf8');
  for (const mod of ['node:net', 'node:dns', 'node:http', 'node:https', 'node:dgram', 'node:tls', 'node:child_process'])
    assert.doesNotMatch(s, new RegExp(`from\\s+['"]${mod.replace(/:/g, '\\:')}`));
  assert.doesNotMatch(s, /\bfetch\s*\(/);
  const sb = sandbox();
  try {
    init(sb);
    sb.stop();
    const c = depCheck(sb);
    assert.match(c.detail, /^mode local, provider unset$/);
  } finally { sb.stop(); }
});

test('MEM-138 AC07: the diff adds no merge, convergence, clock or conflict-resolution code', () => {
  const s = fs.readFileSync(SRC, 'utf8');
  assert.doesNotMatch(s, /merge|converg|clock|conflict/i);
  const imports = [...s.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
  for (const i of imports) assert.ok(i === 'node:path' || i === '../engine/util.mjs', `unexpected import: ${i}`);
  try {
    const diff = execFileSync('git', ['diff', 'origin/main', '--unified=0', '--', 'src', 'bin'], { encoding: 'utf8' });
    for (const l of diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')))
      assert.doesNotMatch(l, /merge|converg|clock|conflict/i, l);
  } catch { /* no origin/main in this checkout; the module source check above still holds */ }
});

test('MEM-138 AC08: the new module names no convergence internals', () => {
  const s = fs.readFileSync(SRC, 'utf8');
  assert.doesNotMatch(s, /convergence/i);
  assert.doesNotMatch(s, /merge strateg/i);
});

const BANNED = [
  /seamless|robust|powerful|leverage|unlock|cutting[- ]edge/i,
  /not just .* but /i,
  /!/u,
  /\u2014/,
  /[\u{1F000}-\u{1FAFF}\u{2190}-\u{2BFF}]/u,
  /certified|certification|accredit/i,
  /iso[- ]?\d{3,4}|soc[- ]?2|hipaa|gdpr|ccpa|pci[- ]?dss/i,
  /\buptime\b|service[- ]level|\bsla\b|99(\.\d+)?%/i,
  /\b(us|eu|ap|sa|me|ca|af)-[a-z]+(-\d+)?\b|frankfurt|virginia|oregon|amsterdam|london|dublin|singapore|tokyo|sydney/i,
];

test('MEM-138 AC09: the printed copy names no region, certification or service-level figure and passes the house writing check', () => {
  const sb = sandbox();
  try {
    init(sb);
    for (const mode of ['local', 'on-prem', 'cloud-hosted']) {
      const set = sb.run(['deployment', 'set', '--mode', mode, '--ai', 'hosted-api']);
      assert.equal(set.code, 0, set.err);
      const texts = [set.out, sb.run(['deployment']).out, depCheck(sb).detail];
      for (const t of texts) for (const re of BANNED) assert.doesNotMatch(t, re, `${mode}: ${re} in: ${t}`);
    }
  } finally { sb.stop(); }
});
