// Support intake: memev doctor --bundle is the ticket intake. It ends with where to send the file, and the file
// holds no secret: no token, key or password, and nothing from the home folder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox } from './helpers/cli.mjs';
import { cleanup, PKG } from './helpers/tmp.mjs';
import { supportLines } from '../src/cli/doctor.mjs';

let sb;
const state = () => path.join(sb.root, '.memev');
const SECRETS = {
  github: `ghp_${'a1B2c3D4e5'.repeat(4)}`,
  openai: `sk-${'Zy9Xw8Vu7T'.repeat(3)}`,
  memev: `mv_${'0123abcd'}_${'f'.repeat(32)}`,
  password: 'password=correct-horse-battery',
  aws: 'AKIAABCDEFGHIJKLMNOP',
  slack: 'xoxb-1234567890-abcdefghij',
  quick: 'https://some-name-here.trycloudflare.com',
};
before(() => {
  sb = sandbox();
  const r = sb.run(['init', '--port', String(sb.port), '--no-connect']);
  assert.equal(r.code, 0, r.out + r.err);
  // a daemon log that says things it should not, as a crash dump might
  fs.appendFileSync(path.join(state(), 'daemon.log'), `${Object.values(SECRETS).join('\n')}\nstarted in ${sb.home}/memev for ${sb.home}\n`);
});
after(() => { sb.stop(); cleanup(); });

test('MEM-084 AC03: doctor --bundle prints where to send the bundle and the bundle contains no secret', () => {
  const r = sb.run(['doctor', '--bundle']);
  assert.equal(r.code, 0, r.out + r.err);
  const file = /Support bundle \(no secrets\): (.+)$/m.exec(r.out)[1];
  // where to send it: the support page, which exists, right after the file name
  const after = r.out.slice(r.out.indexOf(file) + file.length);
  assert.match(after, /send this file as described in .*SUPPORT\.md/);
  const page = /described in (.*SUPPORT\.md)/.exec(after)[1];
  assert.equal(fs.existsSync(page), true, 'the page it names exists');
  assert.equal(path.resolve(page), path.join(PKG, 'docs', 'SUPPORT.md'));
  assert.match(fs.readFileSync(page, 'utf8'), /memev doctor --bundle/);
  // the file: valid JSON, and none of the secrets, tokens or keys of this vault
  const text = fs.readFileSync(file, 'utf8');
  assert.doesNotThrow(() => JSON.parse(text));
  for (const [kind, secret] of Object.entries(SECRETS)) assert.equal(text.includes(secret), false, `${kind} is not in the bundle`);
  const real = [];
  const admin = JSON.parse(fs.readFileSync(path.join(state(), 'admin.json'), 'utf8')).token; real.push(admin);
  for (const t of Object.values(JSON.parse(fs.readFileSync(path.join(state(), 'clients.json'), 'utf8')))) real.push(t);
  const keyFile = path.join(state(), 'tunnel-key.txt'); if (fs.existsSync(keyFile)) real.push(fs.readFileSync(keyFile, 'utf8').trim());
  assert.ok(real.length >= 1 && real.every((x) => x && x.length > 8), 'this vault has secrets to look for');
  for (const x of real) assert.equal(text.includes(x), false, 'a real token or key of this vault is not in the bundle');
  assert.equal(/mv_[0-9a-f]{8}_[0-9a-f]{16,}/.test(text), false, 'no Memev token of any kind');
  assert.equal(text.includes(sb.home), false, 'the home folder is shortened');
  assert.equal(fs.statSync(file).mode & 0o077, 0, 'the file is private to the user');
});

test('MEM-084 AC03: the support lines name the page in the package, or the page by name when the package has none', () => {
  assert.match(supportLines(PKG)[0], new RegExp(path.join(PKG, 'docs', 'SUPPORT.md').replace(/[/.]/g, '\\$&')));
  assert.match(supportLines(path.join(PKG, 'nowhere'))[0], /docs\/SUPPORT\.md in the Memev package/);
});

test('MEM-084 AC01: the support page says how to make the bundle, what it holds and what it never holds', () => {
  const page = fs.readFileSync(path.join(PKG, 'docs', 'SUPPORT.md'), 'utf8');
  for (const must of ['memev doctor --bundle', 'What the bundle holds', 'What it never holds', 'Personal', 'Team']) assert.ok(page.includes(must), must);
});
