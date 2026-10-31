// A memev init with neither --port nor --help takes the default port. npm test runs four files at once, and two
// such inits that run together race for that port: both find it free, both choose it, and the second daemon
// cannot listen, so its init exits 1 ("Memev did not start"). Every init a test runs passes the port its
// sandbox reserved. --join adds this computer to another vault and starts no daemon here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PKG } from './helpers/tmp.mjs';

// a memev init as the tests run it: through a helper (run, runAsync, cli, cliTTY, with an optional first
// argument such as env or sb) or as [BIN, 'init', ...] for spawn; git init calls go through other helpers
const CALL = /\b(?:run|runAsync|cli|cliTTY)\(\s*(?:[\w.]+\s*,\s*)?\[\s*'init'([^\]]*)\]|\[\s*BIN\s*,\s*'init'([^\]]*)\]/g;
// inits that start no daemon, each with the reason
const NO_DAEMON = new Map([
  ["test/init-join.test.mjs cliTTY(env, ['init']", 'the TTY answer is "joining": the join flow runs and no local vault or daemon is made'],
]);
const SELF = 'test/sandbox-init-port.test.mjs';

test('MEM-104: every memev init a test runs passes its sandbox port (or --help or --join), so concurrent files never race for the default port', () => {
  const dir = path.join(PKG, 'test');
  const bad = []; let seen = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.test.mjs')).sort()) {
    const rel = `test/${f}`;
    if (rel === SELF) continue;
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of text.matchAll(CALL)) {
      seen++;
      const rest = m[1] ?? m[2] ?? '';
      if (/'--(?:port|help|join)'/.test(rest) || NO_DAEMON.has(`${rel} ${m[0]}`)) continue;
      bad.push(`${rel}:${text.slice(0, m.index).split('\n').length} ${m[0]}`);
    }
  }
  assert.ok(seen >= 100, `the pattern found only ${seen} inits in test/; it no longer matches how the tests run memev`);
  assert.deepEqual(bad, [], `these inits take the default port:\n${bad.join('\n')}`);
});
