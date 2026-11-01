// The production port of memev work impact: openStore(project, { root }) returns a read-only view of the project of the vault at
// root, or null when that project has nothing recorded. The view has one function that reads a kind of record and returns a copy;
// it has no write method and does not hand out the store. The port adds nothing of its own and creates nothing: an unknown project
// is never made by asking about it. The vault is the one door to the project data, so the port goes through it.
import { Vault } from '../engine/vault.mjs';

const vaults = new Map();
const CLI = { agent: 'cli', scopes: ['read'], paths: ['**'] };

export function openStore(project, { root } = {}) {
  if (!root) throw new Error('openStore needs the vault root');
  let v = vaults.get(root);
  if (!v) { v = new Vault(root, { git: false }).open(); vaults.set(root, v); }
  return v.tasksReader(CLI, project);
}

/** Close the vaults the port opened. The command calls this when it is done. */
export function closeStores() {
  for (const v of vaults.values()) { try { v.close(); } catch { /* already closed */ } }
  vaults.clear();
}
