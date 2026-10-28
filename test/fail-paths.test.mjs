// The failure paths from the review, walked the way a person meets them: the failure, what Memev says, and the way
// back. Each one is a T-FAIL case in docs/testing/LAB-TEST-PLAN.md; these are the ones a Linux machine can stage on
// its own, with no second computer and no other operating system.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { sandbox } from './helpers/cli.mjs';
import { tmpdir, cleanup } from './helpers/tmp.mjs';
import { fixFor } from '../src/cli/preflight.mjs';

after(() => cleanup());
const config = (sb) => JSON.parse(fs.readFileSync(path.join(sb.root, '.memev', 'config.json'), 'utf8'));
const health = async (port) => (await fetch(`http://127.0.0.1:${port}/healthz`)).json();
const INIT = ['--local-only', '--no-connect'];

test('MEM-100 AC02: no-git (T-FAIL-14): init stops before writing anything and names the fix; once git is installed it completes', () => {
  const sb = sandbox();
  const nodeonly = path.join(tmpdir('nodeonly-'), 'bin'); fs.mkdirSync(nodeonly);
  fs.symlinkSync(process.execPath, path.join(nodeonly, 'node'));
  try {
    const r = sb.run(['init', '--port', String(sb.port), ...INIT], { extraEnv: { PATH: nodeonly } });
    const said = r.out + r.err;
    assert.notEqual(r.code, 0, said);
    assert.match(said, /git installed: git was not found on PATH/);
    assert.ok(said.includes(fixFor('git', process.platform)), `the fix for this platform:\n${said}`);
    assert.doesNotMatch(said, /Cannot read properties|TypeError|at .*\.mjs:\d+/, 'no raw JavaScript error');
    assert.deepEqual(fs.readdirSync(sb.home), [], 'nothing written, so nothing half-built to clean up');
    // git installed (here: back on PATH), the same command completes and doctor is clean
    const again = sb.run(['init', '--port', String(sb.port), ...INIT]);
    assert.equal(again.code, 0, again.out + again.err);
    const doc = sb.run(['doctor']);
    assert.equal(doc.code, 0, doc.out);
    assert.match(doc.out, /git installed/);
  } finally { sb.stop(); }
});

// another program on the port, answering /healthz the way an unrelated local service might
const OTHER = "require('http').createServer((q,s)=>{s.setHeader('content-type','application/json');s.end('{\"ok\":true}')}).listen(+process.argv[1],'127.0.0.1',()=>process.stdout.write('up\\n'))";

test('MEM-100 AC02: port in use (T-FAIL-07): init moves to a free port and says so in one line, doctor is clean, the other program keeps its port', async () => {
  const sb = sandbox({ ports: 2 }); const busy = sb.port;
  const other = spawn(process.execPath, ['-e', OTHER, String(busy)], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((resolve, reject) => { other.stdout.once('data', resolve); other.once('exit', (c) => reject(new Error(`the other program exited with ${c}`))); });
    const r = sb.run(['init', '--port', String(busy), ...INIT]);
    assert.equal(r.code, 0, r.out + r.err);
    const { port, vault_id } = config(sb);
    assert.notEqual(port, busy);
    const said = r.out.split('\n').filter((l) => l.includes(`Port ${busy}`));
    assert.equal(said.length, 1, r.out);
    assert.ok(said[0].includes(`Port ${busy} is in use by another program; Memev is using ${port}`), r.out);
    assert.equal((await health(port)).vault_id, vault_id, "the daemon on the saved port is this vault's");
    const doc = sb.run(['doctor']);
    assert.equal(doc.code, 0, doc.out);
    assert.deepEqual(await health(busy), { ok: true }, 'the other program still answers on its port');
  } finally { sb.stop(); other.kill(); }
});

test('MEM-100 AC02: second vault (T-FAIL-15): a second vault never passes for the first, each daemon names its own vault, and doctor warns about both', async () => {
  const a = sandbox({ ports: 2 }), b = sandbox();
  try {
    assert.equal(a.run(['init', '--port', String(a.port), ...INIT]).code, 0);
    const r = b.run(['init', '--port', String(a.port), ...INIT]);
    assert.equal(r.code, 0, r.out + r.err);
    const A = config(a), B = config(b);
    assert.notEqual(B.port, A.port, 'the second vault is on its own port');
    assert.notEqual(B.vault_id, A.vault_id);
    assert.equal((await health(A.port)).vault_id, A.vault_id);
    assert.equal((await health(B.port)).vault_id, B.vault_id);
    // the second vault works against its own daemon: what it saves, it recalls, and the first never sees it
    assert.equal(b.run(['remember', 'the second vault keeps its own notes about the blue widget']).code, 0);
    assert.match(b.run(['recall', 'blue widget']).out, /blue widget/);
    const first = a.run(['recall', 'blue widget']);
    assert.equal(first.code, 0, first.out + first.err);
    assert.match(first.out, /^Nothing found\./m, 'the first vault never sees the note');
    const doc = a.run(['doctor']);
    assert.match(doc.out, /two vaults on this computer/, doc.out);
    assert.ok(doc.out.includes(A.vault_id) && doc.out.includes(B.vault_id), doc.out);
  } finally { b.stop(); a.stop(); }
});
