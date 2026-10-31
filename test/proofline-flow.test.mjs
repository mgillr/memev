// "I have a project, build me X": request → contract → sign → compaction → partial build → verify
// shows what is left → finish → verify PASS. Through the real CLI, hooks, daemon and MCP proxy.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, mcpClient } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';
import { inferRequirements } from '../src/engine/contracts.mjs';
import { isBuildRequest } from '../src/cli/hooks.mjs';

let sb;
before(() => { sb = sandbox(); const r = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']); assert.equal(r.code, 0, r.err + r.out); const on = sb.run(['contracts', 'on']); assert.equal(on.code, 0, on.err); });
after(() => { sb.stop(); cleanup(); });
const ctx = (r) => { assert.equal(r.code, 0, r.err); return r.out ? JSON.parse(r.out).hookSpecificOutput?.additionalContext || '' : ''; };
const data = (r) => { assert.ok(!r.isError, r.content?.[0]?.text); return r.structuredContent; };

test('build requests are recognised and requirements are inferred from plain text', () => {
  assert.ok(isBuildRequest('I have a project, build me a CLI that greets people'));
  assert.ok(isBuildRequest('can you make me a small dashboard for my logs'));
  assert.ok(!isBuildRequest('what did we decide about the database?'));
  assert.deepEqual(inferRequirements('Build me a greeter CLI with greet.js, a --shout flag and a README.md'), ['Build me a greeter CLI', 'greet.js', 'a --shout flag', 'a README.md']);
  assert.deepEqual(inferRequirements('I have a project:\n- parse the CSV\n- 2. export JSON\n* add tests'), ['parse the CSV', '2. export JSON', 'add tests']);
});

test('request → signed contract → survives compaction → partial build → remaining → PASS', async () => {
  const wd = path.join(sb.home, 'greeter'); fs.mkdirSync(wd);
  const sess = 'sess-build-1';
  const base = { session_id: sess, transcript_path: path.join(sb.home, 't.jsonl'), cwd: wd };
  const request = 'I have a project, build me a greeter CLI: greet.js prints "Hello, <name>", with a README explaining usage';

  // 1. the prompt hook tells the session to make a contract first; the user does nothing else
  ctx(sb.hook('session-start', { ...base, source: 'startup' }));
  assert.match(ctx(sb.hook('prompt', { ...base, prompt: request })), /memev_contract_from_request/);

  const m = mcpClient(sb, 'claude-code');
  try {
    // 2. the session infers requirements; one without a check is sent back, not guessed
    const vague = data(await m.tool('memev_contract_from_request', { request, project: 'greeter', workdir: wd, requirements: ['make it friendly'] }));
    assert.equal(vague.status, 'needs_checks');
    assert.equal(vague.missing[0].requirement, 'make it friendly');
    const d = data(await m.tool('memev_contract_from_request', { request, project: 'greeter', workdir: wd, session: sess, decisions: ['greeter uses plain node'], requirements: [
      { title: 'greet.js entry point', check: { file: 'greet.js' } },
      { title: 'prints Hello, <name>', check: { cmd: 'node greet.js Ada | grep -q "Hello, Ada"' } },
      { title: 'README explains usage', check: { grep: { file: 'README.md', pattern: 'Usage' } } },
    ] }));
    assert.equal(d.status, 'draft'); assert.equal(d.tasks.length, 3);

    // 3. self-sign; it becomes a memory linked to the project, the conversation and the decision
    const s = data(await m.tool('memev_contract_sign', { id: d.id, session: sess }));
    assert.equal(s.signed, true); assert.equal(s.version, 1); assert.ok(s.memory?.startsWith('memory/decisions/'));
    const g = data(await m.tool('memev_graph', { entity: `contract ${d.id}` }));
    const names = JSON.stringify(g.neighbours);
    assert.match(names, /greeter/); assert.match(names, /sess-build-1/); assert.match(names, /plain node/);
    const w = await m.tool('memev_write', { path: `contracts/signed/${d.id}.json`, body: '{}' });
    assert.ok(w.isError && /immutable/.test(w.content[0].text), 'a signed contract cannot be edited');

    // 4. compaction: the new context gets the contract and its remaining tasks back
    let card = ctx(sb.hook('session-start', { ...base, source: 'compact' }, 'claude-code', ['--project', 'greeter']));
    assert.match(card, new RegExp(`Active contract ${d.id} v1`));
    assert.match(card, /0\/3 tasks pass, not verified yet/);
    assert.match(card, /T3 README explains usage \(NOT VERIFIED\)/);

    // 5. partial build: verify reports per task and what is left, and writes a receipt
    fs.writeFileSync(path.join(wd, 'greet.js'), 'console.log(`Hello, ${process.argv[2] || "world"}`);\n');
    const v1 = sb.run(['verify', d.id]);
    assert.equal(v1.code, 1, v1.out + v1.err);
    assert.match(v1.out, new RegExp(`FAIL ${d.id}: 2/3 tasks`)); assert.match(v1.out, /FAIL T3 README explains usage: README explains usage: README\.md is missing/);
    const st = data(await m.tool('memev_contract_status', { id: d.id })).contracts[0];
    assert.deepEqual(st.tasks.map((t) => t.status), ['PASS', 'PASS', 'FAIL']);
    assert.deepEqual(st.remaining.map((t) => t.id), ['T3']);
    card = ctx(sb.hook('session-start', { ...base, source: 'resume' }, 'claude-code', ['--project', 'greeter']));
    assert.match(card, /2\/3 tasks pass at last verify/); assert.match(card, /Remaining: T3 README explains usage \(FAIL\)/);
    const receipts = fs.readFileSync(path.join(sb.root, 'contracts', 'receipts', `${d.id}.md`), 'utf8');
    assert.match(receipts, /verify · FAIL · 2\/3 tasks/); assert.match(receipts, /- PASS T1 greet\.js entry point/);

    // 6. finish: the local gate passes, the contract is done, and a second receipt is appended
    fs.writeFileSync(path.join(wd, 'README.md'), '# greeter\n\n## Usage\n\nnode greet.js <name>\n');
    const gate = sb.run(['gate', '--workdir', wd]);
    assert.equal(gate.code, 0, gate.out + gate.err); assert.match(gate.out, new RegExp(`PASS ${d.id}: 3/3 tasks`));
    const done = data(await m.tool('memev_contract_status', { id: d.id, all: true })).contracts[0];
    assert.equal(done.state, 'done'); assert.equal(done.passed, 3);
    assert.match(fs.readFileSync(path.join(sb.root, 'contracts', 'receipts', `${d.id}.md`), 'utf8'), /verify · FAIL[\s\S]*verify · PASS · 3\/3 tasks/);
    assert.match(sb.run(['recall', 'greeter contract signed']).out, new RegExp(d.id));

    // 7. a change of requirements is a new version that points at the old one; the old is never edited
    const a = data(await m.tool('memev_contract_amend', { id: d.id }));
    assert.ok(a.id && a.id !== d.id);
    const amended = JSON.parse(fs.readFileSync(path.join(sb.root, 'contracts', 'drafts', `${a.id}.json`), 'utf8'));
    assert.equal(amended.version, 2); assert.equal(amended.supersedes, d.id);
  } finally { await m.close(); }
});

test('Memev never installs CI workflows: init, connect and contracts leave no .github/workflows anywhere', () => {
  const found = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name === '.github') found.push(p); else walk(p); } } };
  walk(sb.home);
  assert.deepEqual(found, []);
  // and nothing in the product can write one
  const PKG = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  for (const dir of ['src', 'bin', 'templates', 'vendor']) {
    const files = fs.readdirSync(path.join(PKG, dir), { recursive: true }).filter((f) => /\.(mjs|js|md|json)$/.test(f));
    for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(PKG, dir, f), 'utf8'), /\.github\/workflows/, `${dir}/${f}`);
  }
});
