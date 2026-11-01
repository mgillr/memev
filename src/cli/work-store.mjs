// The production port of memev work impact: openStore(project, { root }) returns the project store of the vault at root, the same
// store the daemon uses and the only one, or null when that project has no store. It adds no store of its own and creates nothing:
// an unknown project is never made by asking about it. The vault is the one door to the store, so the port goes through it.
import fs from 'node:fs';
import path from 'node:path';
import { Vault } from '../engine/vault.mjs';

const vaults = new Map();

export function openStore(project, { root } = {}) {
  if (!root) throw new Error('openStore needs the vault root');
  let v = vaults.get(root);
  if (!v) { v = new Vault(root, { git: false }).open(); vaults.set(root, v); }
  const id = v._projectId(project);
  if (!fs.existsSync(path.join(v.state, 'projects', id, 'events.jsonl'))) return null;
  return v.projectStore(id);
}

/** Close the vaults the port opened, which closes their project stores. The command calls this when it is done. */
export function closeStores() {
  for (const v of vaults.values()) { try { v.close(); } catch { /* already closed */ } }
  vaults.clear();
}
