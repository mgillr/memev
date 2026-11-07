// SPDX-License-Identifier: Apache-2.0
// The docs hold together: every relative link and anchor in a Markdown page resolves, every page under docs/ is listed
// in docs/README.md, the README opens with the centred demo video poster, and every module path named in backticks exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.md') ? [path.join(d, e.name)] : []));
const PAGES = ['README.md', 'CHARTER.md', 'SECURITY.md', 'CHANGELOG.md', 'contracts/README.md', 'templates/vault/README.md', ...walk('docs'), ...walk('changelog.d')];
const slug = (h) => h.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, '').trim().replace(/ /g, '-');
const anchors = (text) => text.replace(/```[\s\S]*?```/g, '').split('\n').filter((l) => /^#{1,6} /.test(l)).map((l) => slug(l.replace(/^#+ /, '')));

test('every relative link and anchor in the Markdown pages resolves', () => {
  const broken = [];
  for (const page of PAGES) {
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
});

test('every page under docs/ can be reached from docs/README.md by following links down', () => {
  const seen = new Set(['docs/README.md']); const queue = ['docs/README.md'];
  while (queue.length) {
    const page = queue.pop();
    for (const m of read(page).replace(/```[\s\S]*?```/g, '').matchAll(/\]\(([^)#\s]+\.md)(?:#[^)\s]*)?\)/g)) {
      if (/^(https?:|mailto:)/.test(m[1])) continue; // a vendor page that happens to end in .md is not a docs page
      const next = path.relative(ROOT, path.resolve(path.dirname(path.join(ROOT, page)), m[1])).split(path.sep).join('/');
      if (next.startsWith('docs/') && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  assert.deepEqual(walk('docs').filter((p) => !seen.has(p)), []);
});

test('every docs page links back up', () => {
  const orphans = walk('docs').filter((p) => p !== 'docs/README.md').filter((p) => !/\]\((\.\.\/)*(README\.md|docs\/README\.md)[#)]/.test(read(p)) && !/\]\((\.\.\/)*README\.md\)/.test(read(p)));
  assert.deepEqual(orphans, []);
});

test('the README opens with the centred demo video poster, linked to the video in media/', () => {
  const readme = read('README.md');
  assert.match(readme.split('\n')[0], /^<div align="center">$/);
  const top = readme.slice(0, readme.indexOf('</div>'));
  assert.match(top, /<a href="media\/memev-tiers\.mp4"><img src="media\/memev-tiers-poster\.png"/);
  assert.match(top, /<h1>Memev<\/h1>/);
  assert.ok(fs.existsSync(path.join(ROOT, 'media/memev-tiers.mp4')) && fs.existsSync(path.join(ROOT, 'media/memev-tiers-poster.png')));
  assert.ok(!fs.existsSync(path.join(ROOT, 'Demo Video')), 'the earlier cut is replaced, not kept beside the new one');
});

test('file paths named in backticks in the docs exist', () => {
  const missing = [];
  for (const page of PAGES.filter((p) => !p.startsWith('changelog.d/') && p !== 'CHANGELOG.md')) {
    read(page).split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/`((?:src|bin|scripts|test|docs|templates|vendor|contracts|media)\/[A-Za-z0-9_./-]+\.(?:mjs|md|json|sh|ps1|mp4|png))`/g)) if (!fs.existsSync(path.join(ROOT, m[1]))) missing.push(`${page}:${i + 1}: ${m[1]}`);
    });
  }
  assert.deepEqual(missing, []);
});
