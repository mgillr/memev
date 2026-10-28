import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PKG } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';

const compose = path.join(PKG, 'compose.trial.yaml');
const dockerfile = path.join(PKG, 'Dockerfile');
const docs = path.join(PKG, 'docs', 'DOCKER.md');
const script = path.join(PKG, 'scripts', 'docker-trial-smoke.sh');
const changelog = path.join(PKG, 'changelog.d', 'MEM-141.md');
const mainMjs = path.join(PKG, 'src', 'cli', 'main.mjs');
const doctorMjs = path.join(PKG, 'src', 'cli', 'doctor.mjs');

test('MEM-141 AC01: compose.trial.yaml starts the trial with one command', () => {
  const text = fs.readFileSync(compose, 'utf8');
  assert.match(text, /services:/);
  assert.match(text, /memev:/);
  assert.match(text, /image:\s*\$\{MEMEV_IMAGE:-memev:trial\}/);
  assert.match(text, /build:\s*\./);
  assert.match(text, /restart:\s*unless-stopped/);
  assert.match(text, /127\.0\.0\.1:7787:7787/);
  assert.match(text, /memev-vault:\s*\/vault/);
  assert.doesNotMatch(text, /MEMEV_NO_TUNNEL=0/);
  assert.doesNotMatch(text, /MEMEV_NO_SERVICE=0/);
  assert.doesNotMatch(text, /MEMEV_REPORT/);
});

test('MEM-141 AC02: image has healthcheck and labels', () => {
  const composeText = fs.readFileSync(compose, 'utf8');
  assert.match(composeText, /healthcheck:/);
  assert.match(composeText, /interval:\s*30s/);
  assert.match(composeText, /timeout:\s*3s/);
  assert.match(composeText, /retries:\s*3/);
  assert.match(composeText, /start_period:\s*10s/);
  const df = fs.readFileSync(dockerfile, 'utf8');
  assert.match(df, /HEALTHCHECK/);
  assert.match(df, /\/healthz/);
  assert.match(df, /USER memev/);
  assert.match(df, /org\.opencontainers\.image\.title/);
  assert.match(df, /org\.opencontainers\.image\.description/);
  assert.match(df, /org\.opencontainers\.image\.licence/);
  assert.match(df, /org\.opencontainers\.image\.version/);
  assert.doesNotMatch(df, /org\.opencontainers\.image\.url/);
  assert.doesNotMatch(df, /org\.opencontainers\.image\.sources/);
});

test('MEM-141 AC03: doctor runs inside the container and reports container facts', () => {
  const sb = sandbox();
  sb.run(['init', '--local-only', '--no-connect']);
  const r = sb.run(['doctor'], { extraEnv: { MEMEV_NO_TUNNEL: '1', MEMEV_NO_SERVICE: '1' } });
  assert.equal(r.code, 0);
  assert.match(r.out, /vault volume mounted and writable/);
  assert.match(r.out, /port published on loopback only/);
  assert.match(r.out, /remote access off/);
  sb.stop();
});

test('MEM-141 AC04: trial setup is documented and the smoke script exists', () => {
  const doc = fs.readFileSync(docs, 'utf8');
  assert.match(doc, /Trial setup/);
  assert.match(doc, /compose\.trial\.yaml/);
  assert.match(doc, /docker compose -f compose\.trial\.yaml up -d/);
  assert.match(doc, /memev license install/);
  assert.ok(fs.existsSync(script));
  const mode = fs.statSync(script).mode & 0o777;
  assert.ok(mode & 0o111, 'script is executable');
  const s = fs.readFileSync(script, 'utf8');
  assert.match(s, /docker compose -f compose\.trial\.yaml build/);
  assert.match(s, /docker compose -f compose\.trial\.yaml up -d/);
  assert.match(s, /healthy/);
  assert.match(s, /memev doctor/);
  assert.match(s, /memev license install/);
  assert.match(s, /docker compose -f compose\.trial\.yaml down -v/);
});

test('MEM-141 AC05: container makes no telemetry', () => {
  const df = fs.readFileSync(dockerfile, 'utf8');
  assert.match(df, /MEMEV_NO_TUNNEL=1/);
  assert.match(df, /MEMEV_NO_SERVICE=1/);
  const composeText = fs.readFileSync(compose, 'utf8');
  assert.match(composeText, /127\.0\.0\.1:7787:7787/);
  assert.doesNotMatch(composeText, /0\.0\.0\.0:/);
  const main = fs.readFileSync(mainMjs, 'utf8');
  const containerBlock = main.slice(main.indexOf("case 'container'"), main.indexOf("case 'selftest'"));
  assert.doesNotMatch(containerBlock, /fetchOut|http\.request|net\.connect/);
});

test('MEM-141 AC06: free core is unchanged and engine is separate', () => {
  const doc = fs.readFileSync(docs, 'utf8');
  assert.match(doc, /convergence engine is a separate component under its own licence/);
  assert.match(doc, /not part of the image/);
});

test('MEM-141 AC07: publishing needs owner go and docs say build locally', () => {
  const doc = fs.readFileSync(docs, 'utf8');
  assert.match(doc, /publishing the image to a registry needs the owner go/);
  assert.match(doc, /build it locally/);
  const cl = fs.readFileSync(changelog, 'utf8');
  assert.match(cl, /publishing the image to a registry needs the owner go/);
});

test('MEM-141 AC08: user-facing copy passes the house writing check', () => {
  const files = [docs, changelog];
  const banned = /seamless|robust|powerful|leverage|unlock|cutting-edge|certified|not just .* but /i;
  const emoji = /[\u{1F300}-\u{1F9FF}]/u;
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(text, banned, `${f} has banned words`);
    assert.doesNotMatch(text, emoji, `${f} has emoji`);
    assert.doesNotMatch(text, /!/, `${f} has exclamation mark`);
    assert.doesNotMatch(text, /—/, `${f} has em-dash`);
  }
});
