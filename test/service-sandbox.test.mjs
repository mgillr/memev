// launchctl, systemctl and schtasks act on the whole user account, not on the HOME in use, so a sandbox (MEMEV_NO_SERVICE
// set, as every test sandbox sets it) must never reach them: a test run would otherwise replace the person's own login
// service with one that points at a temporary folder. A fake service manager on PATH records every call.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox } from './helpers/cli.mjs';
import { tmpdir, cleanup } from './helpers/tmp.mjs';
import { unitPaths } from '../src/cli/service.mjs';

after(() => cleanup());
const posix = process.platform !== 'win32';
function fakeServiceManager() {
  const bin = tmpdir('fake-svc-'); const log = path.join(bin, 'calls.log');
  for (const name of ['launchctl', 'systemctl', 'loginctl', 'schtasks']) fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> '${log}'\n`, { mode: 0o755 });
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []);
  return { bin, calls };
}

test('with MEMEV_NO_SERVICE set, doctor --fix, service install, service remove and uninstall never call the service manager', { skip: !posix && 'POSIX service managers' }, () => {
  const sb = sandbox(); const svc = fakeServiceManager();
  const PATH = svc.bin + path.delimiter + sb.env.PATH;
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect'], { extraEnv: { PATH } }).code, 0);
    const doc = sb.run(['doctor'], { extraEnv: { PATH } });
    assert.match(doc.out, /✓ starts at login: off: MEMEV_NO_SERVICE is set/, doc.out);
    sb.run(['doctor', '--fix'], { extraEnv: { PATH } });
    const install = sb.run(['service', 'install'], { extraEnv: { PATH } });
    assert.match(install.out + install.err, /MEMEV_NO_SERVICE is set, so no login service is installed/);
    const unit = unitPaths(sb.env).file;
    assert.equal(fs.existsSync(unit), false, 'no unit or plist written');
    // a unit left by an earlier install: removing it under the flag still leaves the service manager alone
    fs.mkdirSync(path.dirname(unit), { recursive: true }); fs.writeFileSync(unit, 'left by an earlier install\n');
    sb.run(['service', 'remove'], { extraEnv: { PATH } });
    sb.run(['uninstall', '--purge'], { extraEnv: { PATH } });
    assert.deepEqual(svc.calls(), [], 'no launchctl, systemctl, loginctl or schtasks call');
  } finally { sb.stop(); }
});

test('without the flag the same fake service manager is reached, so the check above can fail', { skip: !posix && 'POSIX service managers' }, () => {
  const sb = sandbox(); const svc = fakeServiceManager();
  const extraEnv = { PATH: svc.bin + path.delimiter + sb.env.PATH, MEMEV_NO_SERVICE: '' };
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
    sb.run(['service', 'install'], { extraEnv });
    assert.ok(svc.calls().some((c) => /^(launchctl|systemctl) /.test(c)), `the fake was called: ${JSON.stringify(svc.calls())}`);
  } finally { sb.run(['service', 'remove'], { extraEnv }); sb.stop(); }
});
