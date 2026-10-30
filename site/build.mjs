#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// I copy the two static sites (site/web and site/landing) into site/dist and fill the
// config placeholders with the values from the config file named by SITE_CONFIG.
// The config holds the company name, the two host names, the contact address, the postal
// address, the phone, the two site URLs and the form endpoint or mailto address.
// It also names the demo film, which I copy into site/dist. No other tool runs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const cfgPath = process.env.SITE_CONFIG;
if (!cfgPath) {
  console.error('set SITE_CONFIG to the path of the site config file');
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(path.resolve(cfgPath), 'utf8'));

const keys = ['companyName', 'webHost', 'landingHost', 'memoraUrl', 'memevUrl', 'contactAddress', 'postalAddress', 'phone', 'formAction', 'videoPath'];
for (const k of keys) {
  if (typeof cfg[k] !== 'string') {
    console.error(`site config is missing the string value "${k}"`);
    process.exit(1);
  }
}

const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

for (const name of ['web', 'landing']) {
  const src = path.join(root, name);
  const dst = path.join(dist, name);
  copyTree(src, dst);
  for (const f of fs.readdirSync(dst, { recursive: true })) {
    const p = path.join(dst, f);
    if (fs.statSync(p).isFile() && (f.endsWith('.html') || f.endsWith('.css'))) {
      let t = fs.readFileSync(p, 'utf8');
      for (const k of keys) t = t.replaceAll(`{{${k}}}`, cfg[k]);
      fs.writeFileSync(p, t);
    }
  }
}

const videoSrc = path.resolve(cfgPath, '..', cfg.videoPath);
if (!fs.existsSync(videoSrc)) {
  console.error(`the demo film is not at ${videoSrc}`);
  process.exit(1);
}
fs.mkdirSync(path.join(dist, 'web'), { recursive: true });
fs.copyFileSync(videoSrc, path.join(dist, 'web', 'memev-tiers.mp4'));

console.log(`site/dist is ready: web and landing, with the demo film`);
