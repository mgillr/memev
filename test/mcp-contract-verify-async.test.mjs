// SPDX-License-Identifier: Apache-2.0
// contractVerify is async (SR-0.03: it runs metric criteria). The memev_contract_verify tool is its only caller in src/,
// so the handler has to await it: through the MCP surface the caller must get the real verify result, never a Promise.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { handle } from '../src/server/mcp.mjs';
import { newVault, cleanup, OWNER } from './helpers/tmp.mjs';
after(cleanup);

const ctx = { identity: OWNER, client: 'test', session: 's1', local: true };
const call = async (v, name, args) => {
  const r = await handle(v, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx);
  return { error: !!r.result.isError, text: r.result.content[0].text, data: r.result.structuredContent };
};
function signed(v, root, { good }) {
  const work = path.join(root, '..', `awork-${good ? 'g' : 'b'}`); fs.mkdirSync(path.join(work, 'src'), { recursive: true });
  fs.writeFileSync(path.join(work, 'src', 'a.js'), good ? 'export const a = 1;\n' : 'export const b = 1;\n');
  const d = v.contractDraft(OWNER, { title: 'Async verify', project: 'shop', workdir: work, tasks: [{ id: 'T1', title: 'a', scope: ['src/**'], criteria: [
    { statement: 'a.js exports a', verifier: { type: 'grep', file: 'src/a.js', pattern: 'export const a' } },
  ] }] });
  v.contractSign(OWNER, { id: d.id, session: 's1' });
  return d.id;
}

test('memev_contract_verify returns the settled verify result, not a Promise, for a passing contract', async () => {
  const { root, v } = newVault();
  const id = signed(v, root, { good: true });
  const r = await call(v, 'memev_contract_verify', { id });
  assert.equal(r.error, false, r.text);
  assert.ok(r.data && typeof r.data === 'object', 'structured content is an object');
  assert.equal(typeof r.data.data?.then, 'undefined', 'the data is not a thenable');
  assert.equal(r.data.ok, true, r.text);
  assert.ok(Array.isArray(r.data.tasks), 'per-task results are present');
  assert.equal(r.data.tasks[0].criteria.length, 1);
  assert.ok(r.data.tasks[0].criteria[0].pass === true || r.data.tasks[0].criteria[0].status === 'PASS', JSON.stringify(r.data.tasks[0].criteria[0]));
  assert.match(r.text, /"ok":\s*true/);
  assert.doesNotMatch(r.text, /\[object Promise\]/);
  v.close();
});

test('memev_contract_verify returns a real FAIL result for a failing contract, with what is left', async () => {
  const { root, v } = newVault();
  const id = signed(v, root, { good: false });
  const r = await call(v, 'memev_contract_verify', { id });
  assert.equal(r.data.ok, false, r.text);
  assert.ok(Array.isArray(r.data.tasks) && r.data.tasks.length === 1, 'per-task results are present on a failure');
  assert.doesNotMatch(r.text, /\[object Promise\]/);
  v.close();
});
