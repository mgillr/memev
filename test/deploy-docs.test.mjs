// SPDX-License-Identifier: Apache-2.0
// The two deployment pages and the Business section that compares them: what each says and in what
// order, that the mode and provider values and the command spellings come from
// src/cli/deployment.mjs, that every relative link in the new copy resolves, and that the new copy
// passes the mechanical house writing check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODES, PROVIDERS } from '../src/cli/deployment.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const cloud = read('docs/deploy-cloud.md');
const onPrem = read('docs/deploy-on-prem.md');
const business = read('docs/tiers/business.md');
const tiersReadme = read('docs/tiers/README.md');
const services = read('docs/tiers/services.md');

const SECTION = '## Where it runs: cloud-hosted or on your own servers';
const section = (text, heading) => {
  const start = text.indexOf(heading);
  assert.ok(start >= 0, `${heading} is missing`);
  const rest = text.slice(start + heading.length);
  const end = rest.search(/\n## /);
  return end < 0 ? rest : rest.slice(0, end);
};
const businessSection = section(business, SECTION);
const readmeRow = tiersReadme.split('\n').find((l) => l.startsWith('| Where Memev runs'));
// Phrases may wrap across lines in the pages; match on flattened whitespace.
const flat = (s) => s.replace(/\s+/g, ' ');
assert.ok(readmeRow, 'the Where Memev runs row is still in the tiers README');

test('MEM-139 AC01: deploy-cloud.md says who it is for, what runs where, what you keep, the command and the planned status, in that order', () => {
  const order = [
    'external hosted AI provider',
    'host the operator manages',
    'with your own keys',
    'holds no provider keys',
    'git backup remains possible',
    'Export always works',
    'memev deployment set --mode cloud-hosted --ai hosted-api|mixed',
    'The service is planned and has no date.',
  ];
  let at = -1;
  for (const phrase of order) {
    const i = cloud.indexOf(phrase, at + 1);
    assert.ok(i > at, `not found after the previous point: ${phrase}`);
    at = i;
  }
});

test('MEM-139 AC02: deploy-on-prem.md says who it is for, what runs where, the air-gapped limits, the command and the Docker link', () => {
  for (const phrase of [
    'internal model',
    'strict data residency',
    'compliance-led or air-gapped',
    'The vault server runs on your own servers.',
    'Any internal model stays inside your environment.',
    "can't use a cloud AI service or the hosted relay",
    'memev deployment set --mode on-prem --ai internal-llm|mixed',
    '[DOCKER.md](DOCKER.md)',
  ]) assert.ok(flat(onPrem).includes(phrase), `missing: ${phrase}`);
});

test('MEM-139 AC03: the mode and provider values and the command spellings come from src/cli/deployment.mjs, and every valid value appears in a page', () => {
  const src = read('src/cli/deployment.mjs');
  const usage = /memev deployment set --mode <([^>]+)> \[--ai <([^>]+)>]/.exec(src);
  assert.ok(usage, 'the usage line is in src/cli/deployment.mjs');
  const usageModes = usage[1].split('|');
  const usageAis = usage[2].split('|');
  assert.deepEqual(MODES, usageModes, 'MODES matches the usage line');
  assert.deepEqual(PROVIDERS, usageAis, 'PROVIDERS matches the usage line');
  for (const flag of ['--mode', '--ai']) assert.ok(usage[0].includes(flag), `the usage line spells ${flag}`);
  const pages = [cloud, onPrem];
  for (const m of MODES) assert.ok(pages.some((p) => p.includes(m)), `mode ${m} appears in no page`);
  for (const a of PROVIDERS) assert.ok(pages.some((p) => p.includes(a)), `provider ${a} appears in no page`);
  const cmd = (mode, ais) => `memev deployment set --mode ${mode} --ai ${ais}`;
  assert.ok(cloud.includes(cmd('cloud-hosted', 'hosted-api|mixed')), 'the cloud page spells the command');
  assert.ok(onPrem.includes(cmd('on-prem', 'internal-llm|mixed')), 'the on-prem page spells the command');
});

test('MEM-139 AC04: both pages say a note sent to a hosted provider leaves your control once sent, that local-only routing is planned not built, and carry planned labels', () => {
  for (const [name, page] of [['cloud', cloud], ['on-prem', onPrem]]) {
    assert.match(flat(page), /leaves your control once sent/, `${name}: leaves your control`);
    assert.match(flat(page), /routing restricted notes only to a local model is planned, not built/i, `${name}: local-only routing`);
    assert.match(page, /\bplanned\b/, `${name}: planned label`);
  }
  assert.match(cloud, /planned and has no date/);
});

test('MEM-139 AC05: both pages name the trial path that fits, the free parts, the paid setup row, and name no count, price, region, certification or uptime figure', () => {
  assert.match(flat(cloud), /self-serve Business trial/);
  assert.match(flat(cloud), /hosted-api or mixed/);
  assert.match(flat(cloud), /free/);
  assert.match(flat(cloud), /no card/);
  assert.match(flat(cloud), /provisioned self-serve/);
  assert.match(flat(cloud), /docs\/CLOUD-TRIAL\.md/);
  assert.match(flat(onPrem), /sales-assisted pilot/);
  assert.match(flat(onPrem), /internal-llm or a compliance review/);
  assert.match(flat(onPrem), /size is set by order form/);
  assert.match(flat(onPrem), /term starts at licence install/);
  assert.match(flat(onPrem), /trial licence itself is free/);
  assert.match(flat(onPrem), /installing it yourself with the container image is free/);
  assert.match(flat(onPrem), /setup done by the operator is a paid service/i);
  assert.match(flat(onPrem), /rate card in \[services\.md\]\(tiers\/services\.md\)/);
  const row = services.split('\n').find((l) => l.startsWith('| Trial setup, on-prem'));
  assert.ok(row, 'services.md has the Trial setup, on-prem row');
  assert.match(row, /priced on your requirements/);
  const NO_COUNT = /\b\d+\s+(members|computers|seats|people|users)\b/i;
  const NO_PRICE = /[$€£]\s?\d|\bCHF\b|\bEUR\b|\bUSD\b/i;
  for (const [name, page] of [['cloud', cloud], ['on-prem', onPrem]]) {
    assert.ok(!NO_COUNT.test(flat(page)), `${name}: a member or computer count`);
    assert.ok(!NO_PRICE.test(flat(page)), `${name}: a price or currency amount`);
  }
  const NO_REGION = /\b(us|eu|ap|sa|me|ca|af)-(east|west|north|south|central|northeast|southeast|northwest|southwest)-\d\b|\b(Frankfurt|Virginia|Oregon|Ohio|Dublin|London|Paris|Amsterdam|Singapore|Sydney|Tokyo|Seoul|Mumbai|Jakarta|Sao Paulo|Cape Town|Zurich|Stockholm|Helsinki|Warsaw|Madrid|Milan|Montreal|Toronto|Dusseldorf|New York|California|Texas|Florida|Germany|France|Ireland|Netherlands|Australia|Japan|South Korea|India|Brazil|South Africa|Canada|United States|USA)\b/i;
  const NO_CERT = /\b(ISO|SOC|GDPR|HIPAA|FedRAMP|PCI)\b|certif|accredit/i;
  const NO_UPTIME = /\buptime\b|\bSLA\b|service level|\b99(\.\d+)?\s*%|\b\d{1,2}(\.\d+)?\s*(%|percent)\b/i;
  for (const [name, text] of [['cloud', cloud], ['on-prem', onPrem], ['business section', businessSection]]) {
    assert.ok(!NO_REGION.test(flat(text)), `${name}: a region name`);
    assert.ok(!NO_CERT.test(flat(text)), `${name}: a certification word`);
    assert.ok(!NO_UPTIME.test(flat(text)), `${name}: an uptime figure`);
  }
});

test('MEM-139 AC06: business.md gains the comparison section with its four rows and both links, keeps every earlier heading, and the README row names both options', () => {
  for (const row of ['Who runs the server', 'Where AI provider calls go', 'Which trial path', 'Status']) {
    assert.ok(businessSection.includes(row), `missing row: ${row}`);
  }
  assert.ok(businessSection.includes('[deploy-cloud.md](../deploy-cloud.md)'));
  assert.ok(businessSection.includes('[deploy-on-prem.md](../deploy-on-prem.md)'));
  for (const h of [
    '# Business (coming)',
    '## How it works',
    '### One company vault',
    '### One AI provider',
    '### Personal vaults stay out',
    '### When a member leaves',
    '### Licence and trial',
    '## Worked example: 20 people',
    '### Who sees what',
    '### Sensitive work and the one AI provider',
    '### Company tools',
    '### Hardware',
    '### Cost for this example (draft)',
    "## What's included",
    '## Limits',
    '## Setup',
    '## Support',
    '## Sovereignty',
  ]) assert.ok(business.includes(h), `earlier heading gone: ${h}`);
  assert.ok(readmeRow.includes('a server in your office or your cloud account'), 'the existing row text is kept');
  assert.ok(readmeRow.includes('cloud-hosted'), 'the row names cloud-hosted');
  assert.ok(readmeRow.includes('deploy-cloud.md') && readmeRow.includes('deploy-on-prem.md'), 'the row links both pages');
});

test('MEM-139 AC07: every relative link in the new copy resolves, and the operator is called the operator and named in the order form', () => {
  const targets = [
    ['docs/deploy-cloud.md', cloud],
    ['docs/deploy-on-prem.md', onPrem],
    ['docs/tiers/business.md', businessSection],
    ['docs/tiers/README.md', readmeRow],
  ];
  const broken = [];
  for (const [page, text] of targets) {
    for (const m of text.matchAll(/\]\(([^)#\s]+)(#[^)\s]*)?\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:)/.test(target)) continue;
      const file = path.resolve(path.dirname(path.join(ROOT, page)), target);
      if (!fs.existsSync(file)) broken.push(`${page}: ${target} does not exist`);
    }
  }
  assert.deepEqual(broken, []);
  assert.ok(cloud.includes('the operator'), 'the cloud page calls it the operator');
  assert.ok(onPrem.includes('the operator'), 'the on-prem page calls it the operator');
  assert.ok(onPrem.includes('named in the order form'), 'the operator is named in the order form');
});

test('MEM-139 AC08: the new copy passes the mechanical house writing check', () => {
  const copies = [
    ['docs/deploy-cloud.md', cloud],
    ['docs/deploy-on-prem.md', onPrem],
    ['business.md section', businessSection],
    ['tiers README row', readmeRow],
  ];
  const HYPE = /\b(seamless|robust|powerful|leverage|unlock|cutting-edge)\b/i;
  for (const [name, text] of copies) {
    const t = flat(text);
    assert.ok(!HYPE.test(t), `${name}: stock hype`);
    assert.ok(!/not just .*? but /i.test(t), `${name}: not just X but Y`);
    assert.ok(!/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(t), `${name}: emoji`);
    assert.ok(!t.includes('!'), `${name}: an exclamation mark`);
    assert.ok(!t.includes('\u2014'), `${name}: an em dash`);
    assert.ok(!/certified/i.test(t), `${name}: certified`);
  }
});
