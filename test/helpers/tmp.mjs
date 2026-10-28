import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initVault, Vault } from '../../src/engine/vault.mjs';

// Tests run on whatever machine they happen to land on; give the vault's own computer a fixed
// short name so seat names (my-app@host) are the same everywhere. A test that needs a
// different machine name sets MEMEV_MACHINE_NAME before it opens a vault.
process.env.MEMEV_MACHINE_NAME = process.env.MEMEV_MACHINE_NAME || 'host';

export const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.MEMEV_TEST_TMP || os.tmpdir();
const made = [];
export function tmpdir(prefix = 'memev-') { const d = fs.mkdtempSync(path.join(BASE, prefix)); made.push(d); return d; }
// Windows can still hold a folder for a moment after its daemon was told to stop (EBUSY); a leftover temp folder is
// harmless, so only there is that error let go. Any other failure still throws.
export function cleanup() {
  for (const d of made.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
    catch (e) { if (!(process.platform === 'win32' && e.code === 'EBUSY')) throw e; }
  }
}
export const OWNER = { id: 'test', agent: 'test', scopes: ['read', 'write', 'admin'], paths: ['**'] };
export function newVault(opts = {}) {
  const root = path.join(tmpdir(), 'vault');
  initVault(root, { template: path.join(PKG, 'templates', 'vault') });
  const v = new Vault(root, { commitDelayMs: 10, fsync: false, keyDir: path.join(root, '..', 'keys'), ...opts }).open();
  return { root, v };
}
