// First run, onboarding checklist, doctor and uninstall through the real CLI in a clean home.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';

let sb, claudeSettings, original;
before(() => {
  sb = sandbox();
  fs.mkdirSync(path.join(sb.home, '.claude'), { recursive: true });
  claudeSettings = path.join(sb.home, '.claude', 'settings.json');
  fs.writeFileSync(claudeSettings, '{"permissions":{"allow":["Read"]}}\n');
  fs.mkdirSync(path.join(sb.home, '.gemini'), { recursive: true });
  original = fs.readFileSync(claudeSettings);
});
after(() => { sb.stop(); cleanup(); });

test('memev init in a clean home: vault, daemon, apps connected, remote on by default, checklist', () => {
  const r = sb.run(['init', '--port', String(sb.port)]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /\+ Claude Code: MCP \+ session hooks/);
  assert.match(r.out, /\+ Gemini CLI/);
  assert.match(r.out, /Cloud AI apps.*remote access is on/s);
  assert.match(r.out, /→ Backup to your own private GitHub repository: memev github setup/);
  assert.match(r.out, /✓ Self-test \(memev doctor\): all checks pass/);
  const cfg = JSON.parse(fs.readFileSync(path.join(sb.root, '.memev', 'config.json'), 'utf8'));
  assert.equal(cfg.remote.enabled, true, 'remote access is on by default');
  assert.ok(fs.existsSync(path.join(sb.env.MEMEV_CONFIG_DIR, 'bin', 'memev')), 'stable launcher');
  assert.ok(fs.existsSync(path.join(sb.env.MEMEV_CONFIG_DIR, 'runtime', '0.1.0', 'src', 'engine', 'vault.mjs')), 'runtime copy');
  const hooks = JSON.parse(fs.readFileSync(claudeSettings, 'utf8')).hooks;
  assert.ok(hooks.SessionStart[0].hooks[0].command.includes(path.join(sb.env.MEMEV_CONFIG_DIR, 'bin', 'memev')));
  assert.equal(r.out.includes('mv_'), false, 'no token printed during setup');
});

test('the launcher the apps call works on its own', () => {
  const { spawnSync } = require_();
  const launcher = path.join(sb.env.MEMEV_CONFIG_DIR, 'bin', 'memev');
  const r = spawnSync(launcher, ['hook', 'session-start', '--client', 'claude-code'], { env: sb.env, input: '{"session_id":"x1","source":"startup"}', encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /Memev resume card/);
});

test('cloud off and on with one command each', () => {
  assert.equal(sb.run(['cloud', 'off']).code, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(sb.root, '.memev', 'config.json'), 'utf8')).remote.enabled, false);
  assert.match(sb.run(['cloud', 'status']).out, /off/);
  assert.equal(sb.run(['cloud', 'on']).code, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(sb.root, '.memev', 'config.json'), 'utf8')).remote.enabled, true);
});

test('doctor: healthy exits 0; a problem exits 1 and --fix repairs it; the bundle holds no secrets', () => {
  const ok = sb.run(['doctor']);
  assert.equal(ok.code, 0, ok.out);
  fs.chmodSync(path.join(sb.root, '.memev', 'tokens.json'), 0o644);
  const bad = sb.run(['doctor']);
  assert.equal(bad.code, 1); assert.match(bad.out, /readable by others: tokens\.json/);
  assert.equal(sb.run(['doctor', '--fix']).code, 0);
  assert.equal(sb.run(['doctor']).code, 0);
  const b = sb.run(['doctor', '--bundle']);
  const file = /no secrets\): (.+)$/m.exec(b.out)[1];
  const text = fs.readFileSync(file, 'utf8');
  assert.equal(/mv_[0-9a-f]{8}_[0-9a-f]{32}/.test(text), false);
  assert.equal(text.includes(sb.home), false);
  const key = fs.existsSync(path.join(sb.root, '.memev', 'tunnel-key.txt')) ? fs.readFileSync(path.join(sb.root, '.memev', 'tunnel-key.txt'), 'utf8').trim() : null;
  if (key) assert.equal(text.includes(key), false);
});

test('onboarding re-checks after a manual step', () => {
  const { execFileSync } = require_();
  execFileSync('git', ['remote', 'add', 'origin', path.join(sb.home, 'backup.git')], { cwd: sb.root });
  const r = sb.run(['onboarding']);
  assert.match(r.out, /✓ Backup to your own private GitHub repository: remote origin/);
});

test('uninstall restores the app configs byte for byte and stops the daemon', () => {
  const r = sb.run(['uninstall']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(fs.readFileSync(claudeSettings), original);
  assert.equal(fs.existsSync(path.join(sb.home, '.gemini', 'settings.json')), false);
  assert.equal(fs.existsSync(path.join(sb.root, '.memev', 'daemon.json')), false);
  assert.ok(fs.existsSync(path.join(sb.root, 'memory', 'north-star.md')), 'the vault itself is kept');
});

import * as cp from 'node:child_process';
function require_() { return cp; }
