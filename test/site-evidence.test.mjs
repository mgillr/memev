// WO-03-A: the evidence pages, the complaints analysis and the comparison, as crawlable pages.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir, cleanup, PKG } from './helpers/tmp.mjs';

after(() => cleanup());

const SITE = path.join(PKG, 'site');
const WEB = path.join(SITE, 'web');
const read = (p) => fs.readFileSync(p, 'utf8');
const readHtml = (name) => read(path.join(WEB, `${name}.html`));

// Strip scripts and tags, unescape the entities the pages use, collapse whitespace, lower-case.
const strip = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

// Normalise one line of the source docs: keep the link text, drop the formatting marks, collapse.
const normMd = (line) => line
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/^#{1,6}\s+/, '')
  .replace(/^\s*[-*+]\s+/, '')
  .replace(/[*`|]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const headings = (md) => md.split('\n').filter((l) => /^#{1,6} /.test(l)).map((l) => l.replace(/^#{1,6} /, '').trim());
const statusLines = (md) => md.split('\n').map((l) => l.trim())
  .filter((l) => l && /\b(built|planned)\b/i.test(l) && !/^\|[\s:|-]+\|$/.test(l));
const countWord = (s, w) => (s.match(new RegExp(`\\b${w}\\b`, 'gi')) || []).length;
// Every table cell and prose line of a source page, normalised like normMd: a page whose content is a
// table and prose has few headings and no status lines, so those alone would not notice a dropped row.
const contentItems = (md) => md.split('\n').flatMap((l) => {
  const t = l.trim();
  if (!t || /^#{1,6} /.test(t) || /^\|[\s:|-]+\|$/.test(t) || /^```/.test(t)) return [];
  if (t.startsWith('|')) return t.split('|').slice(1, -1).map(normMd).filter(Boolean);
  return [normMd(t)];
});

// The install command the README shows first: the first code tag in the file.
function installCommand() {
  const m = /<code>([^<]+)<\/code>/.exec(read(path.join(PKG, 'README.md')));
  assert.ok(m, 'the README shows an install command in a code tag');
  return m[1].trim();
}

// Build in a private copy of the site directory so parallel test files never share site/dist.
function runBuild() {
  const root = tmpdir('site-evidence-');
  fs.copyFileSync(path.join(SITE, 'build.mjs'), path.join(root, 'build.mjs'));
    fs.cpSync(path.join(SITE, 'web'), path.join(root, 'web'), { recursive: true });
  fs.cpSync(path.join(SITE, 'landing'), path.join(root, 'landing'), { recursive: true });
  const cfg = {
    companyName: 'Example Company',
    webHost: 'web.example.invalid',
    landingHost: 'www.example.invalid',
    memoraUrl: 'https://memora.example.invalid/',
    memevUrl: 'https://web.example.invalid/',
    contactAddress: 'info@example.invalid',
    postalAddress: 'Example Street 1, 10000 Example City',
    phone: '+00 000 000 000',
    formAction: 'mailto:info@example.invalid',
    videoPath: path.join(PKG, 'media', 'memev-tiers.mp4'),
  };
  const p = path.join(root, 'site-config.json');
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  const r = spawnSync(process.execPath, [path.join(root, 'build.mjs')], {
    env: { ...process.env, SITE_CONFIG: p },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return { cfg, dist: path.join(root, 'dist') };
}

test('WO-03-A AC01: the evidence pages are crawlable, in the shared house style, and link to the quickstart', () => {
  for (const name of ['solutions', 'comparison']) {
    const html = readHtml(name);
    assert.match(html, /<title>[^<]+<\/title>/, `${name} has a title`);
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${name} has one h1`);
    assert.match(html, /<html[^>]*\slang="en"/, `${name} has a lang attribute`);
    assert.match(html, /<meta name="description" content="[^"]+">/, `${name} has a description`);
    assert.match(html, /<header class="site">/, `${name} has the shared header`);
    assert.match(html, /<footer class="site">/, `${name} has the shared footer`);
    const header = html.slice(html.indexOf('<header class="site">'), html.indexOf('</header>'));
    assert.match(header, /<a href="quickstart\.html">/, `${name} header links to the quickstart`);
  }
  const qs = readHtml('quickstart');
  assert.match(qs, /<title>[^<]+<\/title>/, 'quickstart has a title');
  assert.match(qs, /<header class="site">/, 'quickstart has the shared header');
  assert.match(qs, /<footer class="site">/, 'quickstart has the shared footer');

  // No framework and no dependencies: no manifest or node_modules under site/, and the build
  // script imports only node: builtins.
  assert.ok(!fs.existsSync(path.join(SITE, 'package.json')), 'site has no package manifest');
  assert.ok(!fs.existsSync(path.join(SITE, 'node_modules')), 'site has no dependencies');
  const build = read(path.join(SITE, 'build.mjs'));
  for (const m of build.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    assert.match(m[1], /^node:/, `build.mjs imports only node: builtins: ${m[1]}`);
  }

  // The build copies the pages into the output.
  const { dist } = runBuild();
  for (const name of ['solutions.html', 'comparison.html', 'quickstart.html']) {
    assert.ok(fs.existsSync(path.join(dist, 'web', name)), `dist/web has ${name}`);
  }
});

test('WO-03-A AC02: the install command is copyable on both pages and matches the README', () => {
  const cmd = installCommand();
  for (const name of ['solutions', 'comparison']) {
    const html = readHtml(name);
    const pres = [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/g)].map((m) => m[1]);
    assert.ok(pres.length >= 1, `${name} has a pre block`);
    assert.ok(pres.some((p) => p.replace(/<[^>]+>/g, '').trim() === cmd),
      `${name} carries the README install command in a pre block`);
    assert.ok(strip(html).includes(cmd.toLowerCase()), `${name} shows the install command as text`);
  }
});

test('WO-03-A AC03: the complaints analysis keeps every heading, status and the planned wording', () => {
  const md = read(path.join(PKG, 'docs', 'SOLUTIONS.md'));
  const text = strip(readHtml('solutions'));
  for (const h of headings(md)) {
    assert.ok(text.includes(normMd(h)), `the page carries the heading: ${h}`);
  }
  for (const l of statusLines(md)) {
    assert.ok(text.includes(normMd(l)), `the page carries the status line: ${l.slice(0, 60)}`);
  }
  // Nothing planned is rendered as built: the page names at least as many planned items as the
  // source, and makes no built claim the source does not make.
  assert.ok(countWord(text, 'planned') >= countWord(md, 'planned'),
    'the page names at least as many planned items as the source');
  assert.ok(countWord(text, 'built') <= countWord(md, 'built'),
    'the page makes no built claim the source does not make');
});

test('WO-03-A AC03: the comparison keeps every heading, status line, table cell and paragraph', () => {
  const md = read(path.join(PKG, 'docs', 'COMPARISON.md'));
  const text = strip(readHtml('comparison'));
  for (const h of headings(md)) {
    assert.ok(text.includes(normMd(h)), `the page carries the heading: ${h}`);
  }
  for (const l of statusLines(md)) {
    assert.ok(text.includes(normMd(l)), `the page carries the status line: ${l.slice(0, 60)}`);
  }
  for (const c of contentItems(md)) {
    assert.ok(text.includes(c), `the page carries: ${c.slice(0, 60)}`);
  }
  assert.ok(countWord(text, 'built') <= countWord(md, 'built'),
    'the page makes no built claim the source does not make');
});

test('WO-03-A AC04: the pages load nothing from other hosts and every relative link resolves in the build output', () => {
  for (const name of ['solutions', 'comparison', 'quickstart']) {
    const html = readHtml(name);
    assert.ok(!/<script[\s>]/i.test(html), `${name} loads no script`);
    assert.ok(!/<img[\s>]/i.test(html), `${name} loads no image`);
    assert.ok(!/url\(\s*['"]?https?:/i.test(html), `${name} loads no asset from another host`);
    assert.ok(!/@import/i.test(html), `${name} imports no stylesheet from another host`);
    assert.ok(!/<link\b[^>]*\bhref\s*=\s*["']?(https?:)?\/\//i.test(html), `${name} links no stylesheet or icon from another host`);
    assert.ok(!/\bsrc\s*=\s*["']?(https?:)?\/\//i.test(html), `${name} loads nothing by src from another host`);
    assert.ok(!/google-analytics|googletagmanager|gtag|hotjar|clarity|doubleclick/i.test(html),
      `${name} loads no analytics or tag`);
    assert.ok(!/document\.cookie/i.test(html), `${name} sets no cookie`);
  }
  const { dist } = runBuild();
  for (const name of ['solutions', 'comparison', 'quickstart']) {
    const html = read(path.join(dist, 'web', `${name}.html`));
    for (const m of html.matchAll(/href="([^"]+)"/g)) {
      const target = m[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const file = path.join(dist, 'web', target.split('#')[0]);
      assert.ok(fs.existsSync(file), `${name} relative link resolves in the build output: ${target}`);
    }
  }
});
