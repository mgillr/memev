import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sandbox, BIN } from './helpers/cli.mjs';
import { cleanup, OWNER } from './helpers/tmp.mjs';

const dirs = [];
const sb = sandbox();
before(() => {
  const home = fs.mkdtempSync('/tmp/memev-rev004-');
  dirs.push(home);
  const remote = path.join(home, 'remote.git');
  execFileSync('git', ['init', '--bare', remote]);
  sb.env.MEMEV_BACKUP_REMOTE = remote;
});
after(() => { cleanup(dirs); });

test('REV-004 AC02: memev backup set <file url> exits 0 and writes backup.remote', () => {
  const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect'], { timeout: 60000 });
  assert.equal(init.code, 0, `init failed: ${init.err}`);
  const set = sb.run(['backup', 'set', sb.env.MEMEV_BACKUP_REMOTE]);
  assert.equal(set.code, 0, `backup set failed: ${set.err}`);
  const cfgPath = path.join(sb.env.MEMEV_ROOT, '.memev', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.equal(cfg.backup?.remote, sb.env.MEMEV_BACKUP_REMOTE);
});

test('REV-004 AC03: memev backup status prints the configured remote after backup set', () => {
  const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect'], { timeout: 60000 });
  assert.equal(init.code, 0, `init failed: ${init.err}`);
  const set = sb.run(['backup', 'set', sb.env.MEMEV_BACKUP_REMOTE]);
  assert.equal(set.code, 0, `backup set failed: ${set.err}`);
  const st = sb.run(['backup', 'status']);
  assert.equal(st.code, 0, `backup status failed: ${st.err}`);
  assert.ok(st.out.includes(sb.env.MEMEV_BACKUP_REMOTE), `status output missing remote: ${st.out}`);
});
