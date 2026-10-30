// SPDX-License-Identifier: Apache-2.0
// WO-10-A: the sales kit: the customer security brief, the data-flow map and the pilot checklist,
// each answerable without a call, built from text the repository already holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ').trim();
const slug = (h) => h.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, '').trim().replace(/ /g, '-');
const anchors = (text) => text.replace(/```[\s\S]*?```/g, '').split('\n').filter((l) => /^#{1,6} /.test(l)).map((l) => slug(l.replace(/^#+ /, '')));
const section = (text, topic) => {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^## /.test(l) && topic.test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) if (/^## /.test(lines[i])) { end = i; break; }
  return lines.slice(start, end).join('\n');
};

const KITS = ['docs/SECURITY-BRIEF.md', 'docs/DATA-FLOW.md', 'docs/PILOT-CHECKLIST.md'];

test('WO-10-A AC01: the customer security brief exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'docs/SECURITY-BRIEF.md')), 'docs/SECURITY-BRIEF.md is missing');
  const brief = read('docs/SECURITY-BRIEF.md');
  assert.match(brief, /^# /, 'the brief opens with a title');
  assert.ok(brief.length > 300, 'the brief is not a stub');
});

test('WO-10-A AC02: the brief answers the five questions a stranger asks, each linked to the page that holds the detail', () => {
  const brief = read('docs/SECURITY-BRIEF.md');
  const answers = [
    [/where do the notes live/i, ['QUICKSTART.md', 'GITHUB.md']],
    [/what leaves the computer/i, ['DATA-FLOW.md', 'METRICS.md']],
    [/scoped and revoked/i, ['../SECURITY.md']],
    [/threat model covers/i, ['THREAT-MODEL.md']],
    [/built and what is planned/i, ['tiers/README.md']],
  ];
  for (const [topic, links] of answers) {
    const body = section(brief, topic);
    assert.ok(body, `the brief has an answer for: ${topic}`);
    for (const link of links) {
      const re = new RegExp(`\\]\\([^)\\s]*${link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:#[^)\\s]*)?\\)`);
      assert.ok(re.test(body), `the answer for ${topic} links ${link}`);
    }
  }
});

test('WO-10-A AC03: the data-flow map lists every outbound call a default install can make and no other', () => {
  const flow = read('docs/DATA-FLOW.md');
  const threat = read('docs/THREAT-MODEL.md');
  const metrics = read('docs/METRICS.md');
  const body = section(flow, /every outbound call a default install can make/i);
  assert.ok(body, 'the data-flow map has the outbound call section');
  const items = body.split('\n').filter((l) => /^\s*[-*]\s+/.test(l)).map(flat);
  assert.equal(items.length, 3, 'exactly three outbound calls, no more and no fewer');
  const kinds = items.map((t) => {
    if (/licence activation/i.test(t)) return 'licence';
    if (/backup to your own remote/i.test(t)) return 'backup';
    if (/secure link/i.test(t)) return 'link';
    return `unlisted: ${t}`;
  });
  assert.deepEqual(kinds.sort(), ['backup', 'licence', 'link'], 'the calls are licence activation, the backup to your own remote, the secure link');
  assert.match(metrics, /no telemetry/i, 'the metrics page states no telemetry');
  assert.match(flat(flow), /no telemetry/i, 'the data-flow map agrees there is no telemetry');
  assert.match(metrics, /off by default/i, 'the metrics page states the report is off by default');
  assert.match(flat(flow), /milestone report[^.]*off by default|off by default[^.]*milestone report/i, 'the data-flow map agrees the report is off by default');
  assert.match(threat, /deploy key for one private repository only/i, 'the threat model states the backup key is scoped to one repository');
  assert.match(flat(flow), /deploy key[^.]*one repository/i, 'the data-flow map agrees the backup key is scoped to one repository');
});

test('WO-10-A AC04: the pilot checklist runs two to four weeks, agrees week for week with the Business setup table, links the services menu, and marks planned parts planned', () => {
  const pilot = read('docs/PILOT-CHECKLIST.md');
  const business = read('docs/tiers/business.md');
  assert.match(pilot, /two to four weeks/i, 'the pilot runs two to four weeks');
  const setup = section(business, /^## Setup$/);
  assert.ok(setup, 'tiers/business.md has the setup table');
  const biz = {};
  for (const m of setup.matchAll(/^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*$/gm)) biz[m[1]] = flat(m[2]);
  assert.deepEqual(Object.keys(biz).sort(), ['1', '2', '3', '4'], 'the Business setup table has four weeks');
  const rows = {};
  for (const m of pilot.matchAll(/^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/gm)) rows[m[1]] = { step: flat(m[2]), owner: flat(m[3]) };
  assert.deepEqual(Object.keys(rows).sort(), ['1', '2', '3', '4'], 'the pilot has four weeks');
  // The setup table names the on-premises provider with a word that new lines
  // must not repeat, so the checklist says "on-premises model" instead. I take
  // the word from the table itself and read it as "model" on both sides; every
  // other character of every week must still agree.
  const word = (setup.match(/on-premises (\w+)/) || [])[1];
  assert.ok(word, 'the setup table names the on-premises provider');
  const norm = (s) => s.replace(new RegExp(`\\b${word}\\b`, 'gi'), 'model');
  for (const w of ['1', '2', '3', '4']) {
    assert.ok(rows[w].step, `week ${w} has a named step`);
    assert.ok(rows[w].owner, `week ${w} has an owner`);
    assert.equal(norm(rows[w].step), norm(biz[w]), `week ${w} agrees with the Business setup table`);
  }
  assert.ok(pilot.includes('[tiers/services.md](tiers/services.md)'), 'the services menu is linked for anything quoted');
  const planned = section(pilot, /what is planned/i);
  assert.ok(planned, 'the pilot names its planned parts');
  for (const part of ['company server', 'sign-in', 'departments', 'admin console']) {
    const line = planned.split('\n').find((l) => l.toLowerCase().includes(part));
    assert.ok(line, `the planned part ${part} is named`);
    assert.match(line, /planned/i, `${part} is marked planned`);
  }
});

test('WO-10-A AC05: the README lists all three pages, every relative link in them resolves, and no page claims approval, certification or accreditation', () => {
  const readme = read('docs/README.md');
  for (const p of ['SECURITY-BRIEF.md', 'DATA-FLOW.md', 'PILOT-CHECKLIST.md']) {
    assert.ok(readme.includes(`](${p})`), `docs/README.md lists ${p}`);
  }
  const broken = [];
  for (const page of KITS) {
    const text = read(page).replace(/```[\s\S]*?```/g, '');
    for (const m of text.matchAll(/\]\(([^)#\s]*)(#[^)\s]*)?\)/g)) {
      const [, target, hash] = m;
      if (/^(https?:|mailto:)/.test(target)) continue;
      const file = target ? path.resolve(path.dirname(path.join(ROOT, page)), decodeURIComponent(target)) : path.join(ROOT, page);
      if (!fs.existsSync(file)) { broken.push(`${page}: ${target} does not exist`); continue; }
      if (hash && file.endsWith('.md') && !anchors(fs.readFileSync(file, 'utf8')).includes(hash.slice(1))) broken.push(`${page}: ${target}${hash} has no such heading`);
    }
  }
  assert.deepEqual(broken, []);
  const outsideBody = /\b(certif\w+|accredit\w+|approved by|ISO\s?\d{3}|SOC\s?\d|GDPR|HIPAA|FedRAMP|PCI[- ]?DSS)\b/i;
  for (const page of KITS) assert.ok(!outsideBody.test(read(page)), `${page} claims approval, certification or accreditation by an outside body`);
});
