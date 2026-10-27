import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initVault, Vault } from '../../src/engine/vault.mjs';

export const PKG = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const BASE = process.env.MEMEV_TEST_TMP || os.tmpdir();
const made = [];
export function tmpdir(prefix = 'memev-') { const d = fs.mkdtempSync(path.join(BASE, prefix)); made.push(d); return d; }
export function cleanup() { for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true }); }
export const OWNER = { id: 'test', agent: 'test', scopes: ['read', 'write', 'admin'], paths: ['**'] };
export function newVault(opts = {}) {
  const root = path.join(tmpdir(), 'vault');
  initVault(root, { template: path.join(PKG, 'templates', 'vault') });
  const v = new Vault(root, { commitDelayMs: 10, fsync: false, ...opts }).open();
  return { root, v };
}
