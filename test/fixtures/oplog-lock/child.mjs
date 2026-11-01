// SPDX-License-Identifier: Apache-2.0
// A child process for test/oplog-lock.test.mjs (SR-1.01 task 1). It opens a vault, or just an op log, writable or read-only,
// the way `memev claims` does (src/cli/main.mjs), and reports on stdout, one JSON object a line. node child.mjs '<spec json>'
// spec: { root, kind: 'vault' | 'oplog', git, readOnly, segmentBytes, startFile, appends, hold, wait }
// stdin (one JSON object a line): { cmd: 'append' | 'snapshot' | 'roll' | 'archive' | 'close' | 'compact' | 'partial' | 'busy' | 'state' | 'exit', ... }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..', '..', '..', 'src', 'engine');
const spec = JSON.parse(process.argv[2]);
const { OpLog, VaultLocked } = await import(path.join(src, 'oplog.mjs'));
const { Vault } = await import(path.join(src, 'vault.mjs'));
const emit = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (e, from) => ({ event: 'refused', from, name: e.name, code: e.code ?? null, message: e.message, pid: e.pid ?? null, locked: typeof VaultLocked === 'function' && e instanceof VaultLocked, syscall: e.syscall ?? null, errno: e.errno ?? null });
const OWNER = { id: 'test', agent: 'test', scopes: ['read', 'write', 'admin'], paths: ['**'] };

if (spec.startFile) while (!fs.existsSync(spec.startFile)) await sleep(2);
emit({ event: 'starting', pid: process.pid });
let vault = null, log;
try {
  if (spec.kind === 'oplog') log = new OpLog(spec.dir ?? path.join(spec.root, '.memev', 'oplog'), { fsync: false, segmentBytes: spec.segmentBytes, readOnly: !!spec.readOnly }).open();
  else {
    vault = new Vault(spec.root, { git: spec.git === true, fsync: false, segmentBytes: spec.segmentBytes, commitDelayMs: spec.commitDelayMs, readOnly: !!spec.readOnly, keyDir: path.join(spec.root, '..', 'keys') }).open();
    log = vault.log;
  }
} catch (e) { emit(fail(e, 'open')); process.exit(0); }
emit({ event: 'open', pid: process.pid });

let n = 0;
const put = () => (vault ? vault.write(OWNER, { path: `notes/c${process.pid}-${++n}.md`, body: `note ${n}\n` }) : log.append({ type: 'put', path: `n${process.pid}-${++n}`, data: { content: 'x', ch: 'x' } }));
if (spec.appends) {
  for (let i = 0; i < spec.appends; i++) {
    try { put(); } catch (e) { emit(fail(e, 'append')); process.exit(0); }
  }
  emit({ event: 'appended', n: spec.appends });
}
const close = () => (vault ? vault.close() : log.close());
if (spec.hold) { await sleep(spec.hold); try { close(); emit({ event: 'closed' }); } catch (e) { emit(fail(e, 'close')); } process.exit(0); }

if (spec.wait) {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      const c = JSON.parse(line);
      if (c.cmd === 'exit') process.exit(0);
      try {
        let extra = {};
        if (c.cmd === 'append') put();
        else if (c.cmd === 'snapshot') log.snapshot();
        else if (c.cmd === 'roll') log.roll();
        else if (c.cmd === 'archive') extra = { moved: log.archiveSealed() };
        else if (c.cmd === 'close') close();
        else if (c.cmd === 'compact') vault.compact();
        else if (c.cmd === 'partial') fs.appendFileSync(path.join(log.dir, log.active.name), c.text ?? '{"seq":99999,"partial":');
        else if (c.cmd === 'busy') { const end = Date.now() + c.ms; while (Date.now() < end); }
        else if (c.cmd === 'state') extra = { seq: log.seq, verify: log.verify().ok };
        emit({ event: 'reply', cmd: c.cmd, ok: true, ...extra });
      } catch (e) { emit({ ...fail(e, c.cmd), event: 'reply', cmd: c.cmd, ok: false }); }
    }
  });
}
