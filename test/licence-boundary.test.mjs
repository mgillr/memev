// SPDX-License-Identifier: Apache-2.0
// The two pages that describe the convergence engine (docs/CONVERGENCE.md and
// docs/LICENSING-NOTICE.md) must agree: the engine is crdt-merge, it lives in
// its own repository under its original licence, currently BSL 1.1, Memev
// calls it as an external dependency, and it is never vendored. This guard
// pins that agreement so a later edit cannot drift one page from the other or
// name a licence the owner did not choose. Neither page may carry a patent
// word, a patent number or a patent claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readDoc = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PAGES = ['docs/CONVERGENCE.md', 'docs/LICENSING-NOTICE.md'];

const ENGINE_FACTS = [
  ['names the engine as crdt-merge', /crdt-merge/],
  ['names its licence as BSL 1.1', /BSL 1\.1/],
  ['says it lives in its own repository', /own repository/i],
  ['says Memev calls it as an external dependency', /external dependency/i],
  ['says it is never vendored', /never vendored/i],
];

test('WO-05-E AC01: both pages state the same five facts about the engine, so the two statements agree', () => {
  const facts = {};
  for (const f of PAGES) {
    const text = readDoc(f);
    facts[f] = ENGINE_FACTS.map(([, re]) => re.test(text));
    ENGINE_FACTS.forEach(([what, re]) => assert.ok(re.test(text), `${f} does not ${what}`));
  }
  assert.deepEqual(facts[PAGES[0]], facts[PAGES[1]], 'the two pages disagree on which facts they state');
});

const PATENT = [
  ['a patent word', /patent/i],
  ['a patent word', /\bpat\.(?=\s|$)/im],
  ['a patent number', /\b(?:US|EP|WO|DE|GB|JP|CN|KR)\s?-?\d{5,}\b/i],
  ['a patent number', /\bWO\s?\d{4}\/\d{5,}\b/i],
  ['a patent number', /\b\d{1,2},\d{3},\d{3}\b/],
  ['a patent claim', /\bclaim[s]?\s+\d{1,4}\b/i],
];

test('WO-05-E AC02: neither page carries a patent word, a patent number or a patent claim', () => {
  for (const f of PAGES) {
    const text = readDoc(f);
    for (const [what, re] of PATENT) assert.doesNotMatch(text, re, `${f} carries ${what}`);
  }
});

const OTHER_LICENCES = /\b(?:FSL|Apache|MIT|GPL|AGPL|LGPL|MPL|EPL|CDDL|SSPL|BSD|Zlib|Unlicense|CC0|Creative Commons)\b/i;
const engineLines = (text) => text.split('\n').map((line, i) => [i + 1, line]).filter(([, l]) => /crdt-?merge|engine/i.test(l));

test('WO-05-E AC03: docs/CONVERGENCE.md names no other source licence for the engine', () => {
  for (const [n, line] of engineLines(readDoc('docs/CONVERGENCE.md'))) {
    assert.doesNotMatch(line, OTHER_LICENCES, `docs/CONVERGENCE.md line ${n} names another licence: ${line.trim()}`);
  }
});

test('WO-05-E AC04: docs/LICENSING-NOTICE.md names no other source licence for the engine', () => {
  for (const [n, line] of engineLines(readDoc('docs/LICENSING-NOTICE.md'))) {
    assert.doesNotMatch(line, OTHER_LICENCES, `docs/LICENSING-NOTICE.md line ${n} names another licence: ${line.trim()}`);
  }
});

test('WO-05-E AC05: both pages keep the engine on crdt-merge own original licence, currently BSL 1.1, external and never vendored', () => {
  for (const f of PAGES) {
    const text = readDoc(f);
    assert.match(text, /currently BSL 1\.1/, `${f}: the engine keeps its own licence, currently BSL 1.1`);
    assert.match(text, /original licence/i, `${f}: the engine keeps its original licence`);
    assert.match(text, /external dependency/i, `${f}: called as an external dependency`);
    assert.match(text, /never vendored/i, `${f}: never vendored`);
    assert.doesNotMatch(text, /FSL/i, `${f}: the superseded source-available choice is back`);
  }
});

// The engine is never shipped inside Memev: a page may say it is never vendored or bundled, and may
// not say that Memev bundles, vendors, ships or includes it.
const NEGATED = /\b(?:never|not|no)\s+(?:be\s+)?(?:bundled|vendored|shipped|included)\b/gi;
const SHIPPED = /\b(?:bundl\w*|vendor(?:s|ed|ing)?|ships?\s+(?:with|inside)|included\s+in)\b/i;

test('WO-05-E AC05: neither page says Memev bundles, vendors, ships or includes the engine', () => {
  for (const f of PAGES) {
    const text = readDoc(f).replace(NEGATED, '');
    assert.doesNotMatch(text, SHIPPED, `${f} says the engine ships with Memev`);
  }
});
