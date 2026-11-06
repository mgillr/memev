// SPDX-License-Identifier: Apache-2.0
// Half of the recall index gone, as a partial restore or a failing disk leaves it. This test knows only the vault's own surface and which file holds the
// index, so it runs on any version of the code: every word is still found, and the damage is said in status, not passed over in silence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vault, initVault } from '../src/engine/vault.mjs';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ME = { id: 'me', agent: 'tester', scopes: ['read', 'write', 'admin'], paths: ['**'] };
const OPTS = { git: false, fsync: false };
const WORD = (i) => `uniqword${'abcdefghijklmnopqrstuvwxyz'[i % 26]}${'abcdefghijklmnopqrstuvwxyz'[Math.floor(i / 26)]}x`;
const COUNT = 60;

/** The file that holds the index's words: the segment's dictionary where there is a segment, the single index file where there is not. */
function indexFile(root) {
  const seg = path.join(root, '.memev', 'index.seg');
  if (fs.existsSync(path.join(seg, 'CURRENT'))) return path.join(seg, `gen-${fs.readFileSync(path.join(seg, 'CURRENT'), 'utf8')}`, 'dict.txt');
  return path.join(root, '.memev', 'index.jsonl');
}

test('an index cut in half is noticed: every word is still found, and status says what happened', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-noticed-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initVault(root, { template: path.join(PKG, 'templates', 'vault'), port: 47992 });
  const first = new Vault(root, OPTS).open();
  for (let i = 0; i < COUNT; i++) first.write(ME, { path: `notes/n${i}.md`, body: `# Note ${i}\nthe body holds ${WORD(i)} and common words alpha beta\n` });
  first.close();
  const second = new Vault(root, OPTS).open(); second.compact(); second.close();
  const f = indexFile(root); const b = fs.readFileSync(f); assert.ok(b.length > 100, `${f} holds the index`); fs.writeFileSync(f, b.subarray(0, b.length >> 1));
  const v = new Vault(root, OPTS).open(); t.after(() => v.close());
  const missing = []; for (let i = 0; i < COUNT; i++) if (!v.recall(ME, { query: WORD(i), log: false }).some((h) => h.path === `notes/n${i}.md`)) missing.push(i);
  assert.deepEqual(missing, [], 'words an index cut in half no longer finds');
  assert.ok(v.status().index.damage, 'status says the index was found damaged');
});
