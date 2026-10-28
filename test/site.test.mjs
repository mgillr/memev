// MEM-140: the static business site and the main-domain landing page.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir, cleanup, PKG } from './helpers/tmp.mjs';

after(() => cleanup());

const SITE = path.join(PKG, 'site');
const WEB = path.join(SITE, 'web');
const LANDING = path.join(SITE, 'landing');
const read = (p) => fs.readFileSync(p, 'utf8');
const readHtml = (dir, name) => read(path.join(dir, `${name}.html`));
const strip = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const lower = (s) => s.toLowerCase();

const PAGES = ['index', 'personal', 'business', 'trial', 'video', 'contact', 'privacy', 'imprint'];

// The config the build runs against. Reserved example hosts only, so the test never needs a real
// address. The video path points at the demo film in the repository.
function writeConfig(root) {
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
  return { p, cfg };
}

function runBuild() {
  const root = tmpdir('site-');
  const { p, cfg } = writeConfig(root);
  const r = spawnSync(process.execPath, [path.join(SITE, 'build.mjs')], {
    env: { ...process.env, SITE_CONFIG: p },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return { root, cfg, dist: path.join(SITE, 'dist') };
}

// The demo film in the repository, and the only copy of it.
const REPO_VIDEO = path.join(PKG, 'media', 'memev-tiers.mp4');
function findMp4(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    if (e.name === 'dist') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...findMp4(p));
    else if (e.name.endsWith('.mp4')) out.push(p);
  }
  return out;
}

// WCAG relative luminance and contrast ratio, from an [r, g, b] triple.
function lum([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
function hex(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function cssVars(css) {
  const out = {};
  for (const m of css.matchAll(/--([a-z-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

test('MEM-140 AC01: two static sites, one Node script, config from SITE_CONFIG, example hosts only', () => {
  assert.ok(fs.existsSync(WEB), 'site/web exists');
  assert.ok(fs.existsSync(LANDING), 'site/landing exists');
  assert.ok(fs.existsSync(path.join(SITE, 'build.mjs')), 'site/build.mjs exists');
  for (const name of ['web', 'landing']) {
    const manifest = path.join(SITE, name, 'package.json');
    assert.ok(!fs.existsSync(manifest), `${name} has no package manifest`);
  }
  assert.ok(!fs.existsSync(path.join(SITE, 'package.json')), 'site has no package manifest');
  assert.ok(!fs.existsSync(path.join(SITE, 'node_modules')), 'site has no dependencies');

  const { cfg, dist } = runBuild();
  for (const name of ['web', 'landing']) {
    assert.ok(fs.existsSync(path.join(dist, name)), `dist/${name} exists`);
  }
  const built = read(path.join(dist, 'web', 'contact.html'));
  assert.ok(built.includes(cfg.companyName), 'config value is filled in');
  assert.ok(!built.includes('{{companyName}}'), 'no placeholder left');
  assert.ok(fs.existsSync(path.join(dist, 'web', 'memev-tiers.mp4')), 'demo film copied into dist');

  const ex = JSON.parse(read(path.join(SITE, 'config.example.json')));
  for (const k of ['webHost', 'landingHost', 'memoraUrl', 'memevUrl', 'contactAddress', 'postalAddress', 'phone']) {
    assert.ok(/(\.invalid|example\.com)/.test(ex[k]), `config.example.json ${k} is a reserved example value`);
  }
});

test('MEM-140 AC02: every web page has a title, one h1, lang, shared header and footer', () => {
  for (const p of PAGES) {
    const html = readHtml(WEB, p);
    assert.match(html, /<title>[^<]+<\/title>/, `${p} has a title`);
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${p} has one h1`);
    assert.match(html, /<html[^>]*\slang="en"/, `${p} has a lang attribute`);
    assert.match(html, /<header class="site">/, `${p} has the shared header`);
    assert.match(html, /<footer class="site">/, `${p} has the shared footer`);
  }
});

test('MEM-140 AC02: personal covers both Personal tiers with the price read from the doc', () => {
  const doc = read(path.join(PKG, 'docs', 'tiers', 'free.md'));
  const m = /\$12\/month or \$120\/year/.exec(doc);
  assert.ok(m, 'the doc states the Personal with more computers price');
  const price = m[0];
  const html = readHtml(WEB, 'personal');
  const text = lower(strip(html));
  assert.ok(text.includes('personal'), 'personal page names Personal');
  assert.ok(text.includes('personal with more computers'), 'personal page names Personal with more computers');
  assert.ok(html.includes(price), 'the price text matches the doc');
  assert.ok(text.includes('free'), 'the Personal price is free');
});

test('MEM-140 AC02: business covers Business and Corporate, no price, capabilities labelled', () => {
  const html = readHtml(WEB, 'business');
  const text = lower(strip(html));
  assert.ok(text.includes('business'), 'business page names Business');
  assert.ok(text.includes('corporate'), 'business page names Corporate');
  assert.ok(text.includes('contact us'), 'business says contact us');
  assert.ok(!/\$\d/.test(html), 'business shows no price');
  assert.ok(/planned/.test(html) && /coming/.test(html), 'capabilities are labelled planned or coming');
  assert.ok(text.includes('cloud ai service'), 'cloud-hosted option is described');
  assert.ok(text.includes('on-premises llm'), 'on-prem option is described');
});

test('MEM-140 AC03: trial states the free parts, the paid setup, the two paths and the terms', () => {
  const html = readHtml(WEB, 'trial');
  const text = lower(strip(html));
  assert.ok(text.includes('cloud-hosted trial is free and self-serve'), 'cloud-hosted trial is free and self-serve');
  assert.ok(text.includes('trial licence for an on-prem or self-hosted install is free'), 'on-prem trial licence is free');
  assert.ok(text.includes('installing it yourself with the container image is free'), 'self install with the container image is free');
  assert.ok(text.includes('setup done by the operator is a paid service'), 'operator setup is a paid service');
  assert.ok(text.includes('rate card'), 'setup is quoted per the rate card');
  assert.ok(text.includes('self-serve business trial'), 'path one is the self-serve Business trial');
  assert.ok(text.includes('sales-assisted pilot'), 'path two is the sales-assisted pilot');
  assert.ok(text.includes('internal model'), 'pilot is for internal-model organisations');
  assert.ok(text.includes('air-gapped'), 'pilot is for air-gapped organisations');
  assert.ok(text.includes('compliance-led'), 'pilot is for compliance-led organisations');
  assert.ok(text.includes('order form'), 'the size is by order form');
  assert.ok(text.includes('term starts at install'), 'the term starts at install');
  assert.ok(text.includes('14 days, extendable once by 14 days'), '14 days, extendable once by 14 days');
  assert.ok(text.includes('no card needed'), 'no card needed');
  assert.ok(text.includes('nothing is deleted when a trial ends'), 'nothing is deleted when a trial ends');
  assert.ok(/planned/.test(html), 'the trial is labelled planned');
  assert.ok(!/\$\d/.test(html), 'the trial shows no price');
  assert.ok(!/\b\d+\s+(members|computers)\b/.test(text), 'the trial states no member or computer count');
});

test('MEM-140 AC04: video page embeds the film with controls, preload none, scene text, one copy', () => {
  const html = readHtml(WEB, 'video');
  assert.match(html, /<video[^>]*controls[^>]*>/, 'video element with controls');
  assert.match(html, /<video[^>]*preload="none"/, 'preload none');
  assert.match(html, /<video[^>]*src="memev-tiers\.mp4"/, 'src is the demo film');
  assert.ok(!/<script[\s>]/i.test(html), 'no player script');
  assert.ok(!/youtube|vimeo|wistia|cloudflare/i.test(html), 'no third-party embed');
  const list = (html.match(/<li>[\s\S]*?<\/li>/g) || []).map((l) => lower(strip(l)));
  for (const scene of ['personal', 'business', 'corporate', 'trial', 'engine', 'tiers connect']) {
    assert.ok(list.some((l) => l.includes(scene)), `a scene description covers ${scene}`);
  }
  assert.ok(fs.existsSync(REPO_VIDEO), 'the demo film is in the repository');
  const copies = findMp4(PKG);
  assert.deepEqual(copies, [REPO_VIDEO], 'the repository holds one copy of the film');
  const { dist } = runBuild();
  assert.ok(fs.existsSync(path.join(dist, 'web', 'memev-tiers.mp4')), 'build.mjs copies the film into dist');
});

test('MEM-140 AC05: the forms are plain HTML with labels, a data line and a config action', () => {
  for (const p of ['trial', 'contact']) {
    const html = readHtml(WEB, p);
    const form = /<form[\s\S]*?<\/form>/.exec(html);
    assert.ok(form, `${p} has a form`);
    const f = form[0];
    assert.match(f, /action="\{\{formAction\}\}"/, `${p} form action comes from the config`);
    for (const field of ['org', 'email', 'path', 'message']) {
      assert.match(f, new RegExp(`<label for="${field}">`), `${p} form labels the ${field} field`);
      assert.match(f, new RegExp(`<input[^>]*id="${field}"|<select[^>]*id="${field}"|<textarea[^>]*id="${field}"`), `${p} form has the ${field} field`);
    }
    assert.match(f, /class="data-note"/, `${p} form says what happens to the data`);
  }
  for (const p of PAGES) {
    const html = readHtml(WEB, p);
    assert.ok(!/<script[\s>]/i.test(html), `${p} loads no script`);
    assert.ok(!/document\.cookie/i.test(html), `${p} sets no cookie`);
  }
  const { cfg, dist } = runBuild();
  const built = read(path.join(dist, 'web', 'contact.html'));
  assert.ok(built.includes(`action="${cfg.formAction}"`), 'the built form action is the config value');
});

test('MEM-140 AC06: contact and imprint show the config values, landing has two cards', () => {
  for (const p of ['contact', 'imprint']) {
    const html = readHtml(WEB, p);
    assert.ok(html.includes('{{companyName}}'), `${p} shows the company name from the config`);
    assert.ok(html.includes('{{contactAddress}}'), `${p} shows the contact address from the config`);
    assert.ok(html.includes('{{postalAddress}}'), `${p} shows the postal address from the config`);
    assert.ok(html.includes('{{phone}}'), `${p} shows the phone from the config`);
  }
  const { cfg, dist } = runBuild();
  const built = read(path.join(dist, 'web', 'imprint.html'));
  assert.ok(built.includes(cfg.companyName) && built.includes(cfg.contactAddress) && built.includes(cfg.postalAddress) && built.includes(cfg.phone), 'the built imprint shows the config values');
  assert.ok(!built.includes('{{'), 'no placeholder is left when the config is full');

  const landing = read(path.join(LANDING, 'index.html'));
  const cards = landing.match(/class="card"/g) || [];
  assert.equal(cards.length, 2, 'the landing page has two cards');
  assert.match(landing, /href="\{\{memoraUrl\}\}"/, 'one card routes to the Memora site');
  assert.match(landing, /href="\{\{memevUrl\}\}"/, 'one card routes to the Memev site');
  assert.ok(landing.includes('{{companyName}}'), 'the landing page has a company line');
  const builtLanding = read(path.join(dist, 'landing', 'index.html'));
  assert.ok(builtLanding.includes(cfg.memoraUrl) && builtLanding.includes(cfg.memevUrl), 'the built landing routes to the two config URLs');
});

test('MEM-140 AC07: one neutral look, no gradient or animation, AA contrast from the CSS variables', () => {
  const css = read(path.join(WEB, 'styles.css'));
  assert.ok(!/gradient/i.test(css), 'no gradient');
  assert.ok(!/box-shadow|text-shadow/i.test(css), 'no glow');
  assert.ok(!/@keyframes|animation/i.test(css), 'no animation');
  const v = cssVars(css);
  const bg = hex(v.bg);
  const ink = hex(v.ink);
  const navy = hex(v.navy);
  const accent = hex(v.accent);
  assert.ok(contrast(ink, bg) >= 4.5, 'body text meets AA against the background');
  assert.ok(contrast(navy, bg) >= 4.5, 'navy text meets AA against the background');
  assert.ok(contrast(accent, bg) >= 4.5, 'link colour meets AA against the background');
});

test('MEM-140 AC08: no tracking, absolute URLs are example hosts, no release links, no claims', () => {
  const files = [...PAGES.map((p) => path.join(WEB, `${p}.html`)), path.join(WEB, 'styles.css'), path.join(LANDING, 'index.html'), path.join(LANDING, 'styles.css'), path.join(SITE, 'DEPLOY.md')];
  for (const f of files) {
    const t = read(f);
    assert.ok(!/google-analytics|googletagmanager|gtag|facebook\.com\/tr|hotjar|clarity|doubleclick/i.test(t), `${f} loads no analytics or tag`);
    assert.ok(!/@import|url\(\s*['"]?https?:/i.test(t), `${f} loads no font or asset from another host`);
    for (const m of t.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)) {
      const url = m[0];
      assert.ok(/(\.invalid|example\.com)/.test(url), `${f} absolute URL is an example host: ${url}`);
    }
    assert.ok(!/github\.com|npmjs|registry\.|get\.|install\.(sh|ps1)|download/i.test(t), `${f} links to no code host, registry or installer`);
    assert.ok(!/\b(eu-central|ap-southeast|ap-northeast|us-east|us-west|frankfurt|virginia|ohio|germany|france|ireland)\b/i.test(t), `${f} names no region`);
    assert.ok(!/certified|certification|accredit|iso ?9001|soc ?2|uptime|99\.\d+\s*%|service level|sla\b/i.test(t), `${f} makes no certification, accreditation, uptime or service-level claim`);
  }
});

test('MEM-140 AC09: DEPLOY.md lists the steps and says DNS and deploy need the owner go', () => {
  const t = lower(read(path.join(SITE, 'DEPLOY.md')));
  assert.ok(t.includes('static host'), 'DEPLOY names the static host step');
  assert.ok(t.includes('point the two names'), 'DEPLOY points the two names');
  assert.ok(t.includes('config'), 'DEPLOY sets the config values');
  assert.ok(t.includes('build.mjs'), 'DEPLOY runs build.mjs');
  assert.ok(t.includes('upload'), 'DEPLOY uploads site/dist');
  assert.ok(t.includes('dns'), 'DEPLOY names the DNS step');
  assert.ok(t.includes("owner's explicit go"), 'DEPLOY says the deploy needs the owner go');
  assert.ok(!/(\.invalid|example\.com)/.test(read(path.join(SITE, 'DEPLOY.md'))), 'DEPLOY uses placeholder names only');
});

test('MEM-140 AC10: the user-facing copy passes the house writing check', () => {
  const files = [...PAGES.map((p) => path.join(WEB, `${p}.html`)), path.join(WEB, 'styles.css'), path.join(LANDING, 'index.html'), path.join(LANDING, 'styles.css'), path.join(SITE, 'DEPLOY.md')];
  for (const f of files) {
    const t = read(f);
    assert.ok(!/[\u2014\u2013]/.test(t), `${f} has no em-dash or en-dash`);
    assert.ok(!/[!]/.test(strip(t)), `${f} has no exclamation mark`);
    assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t), `${f} has no emoji`);
    assert.ok(!/\bcertified\b/i.test(t), `${f} never says certified`);
    assert.ok(!/\b(seamless|robust|powerful|leverage|unlock|cutting-?edge)\b/i.test(t), `${f} has no stock hype`);
    assert.ok(!/not just .* but /i.test(t), `${f} has no not-just-but framing`);
  }
});
