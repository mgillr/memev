// SPDX-License-Identifier: Apache-2.0
// Issue 444: a signed body carries the whole request, or the draft is refused. It used to be cut at 4,000 characters without a word,
// and the signature's hash of the spec still passed, so nothing said that a reader of the body saw less than the signer was shown.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newVault, cleanup, OWNER } from './helpers/tmp.mjs';
import { ContractError } from '../src/engine/contracts.mjs';

after(cleanup);
const tasks = [{ id: 'T1', title: 'a task', scope: ['**'], criteria: [{ statement: 'it holds', verifier: { type: 'command', cmd: 'true' } }] }];
const draftsOf = (v) => { const d = path.join(v.root, 'contracts', 'drafts'); return fs.existsSync(d) ? fs.readdirSync(d) : []; };

test('a request past the old 4,000 characters is in the signed body whole', () => {
  const { v } = newVault({ git: false });
  const request = `${'asked for in full. '.repeat(320)}The last line is the one that says what was left out.`;
  assert.ok(request.length > 6000);
  const d = v.contractDraft(OWNER, { title: 'A long request', tasks, request });
  const s = v.contractSign(OWNER, { id: d.id, local: true });
  const body = JSON.parse(fs.readFileSync(path.join(v.root, 'contracts', 'signed', `${d.id}.json`), 'utf8'));
  assert.equal(body.request, request);
  assert.ok(s.hash, 'it signed');
  v.close();
});

test('a request a contract cannot hold is refused, naming both lengths, and nothing is drafted', () => {
  const { v } = newVault({ git: false });
  const was = draftsOf(v);
  assert.throws(() => v.contractDraft(OWNER, { title: 'Too long', tasks, request: 'x'.repeat(16001) }), (e) => e instanceof ContractError && e.code === 'bad_request' && /16001/.test(e.message) && /16000/.test(e.message));
  assert.deepEqual(draftsOf(v), was);
  const fits = v.contractDraft(OWNER, { title: 'Just fits', tasks, request: 'x'.repeat(16000) });
  assert.ok(fits.id);
  v.close();
});
