// The production port of memev work impact: openStore(project, { root }) returns the read-only reader that the vault at root gives
// for the project (Vault#tasksReader), or null when that project has nothing recorded. The reader has one function that reads a
// kind of record and returns a copy; it has no write method and does not hand out anything that writes. The vault is the one
// door to the project data, so the port goes through it. The vault object is made and not opened: opening it writes, and this
// port runs beside the daemon.
import { Vault } from '../engine/vault.mjs';

const CLI = { agent: 'cli', scopes: ['read'], paths: ['**'] };

export function openStore(project, { root } = {}) {
  if (!root) throw new Error('openStore needs the vault root');
  return new Vault(root, { git: false }).tasksReader(CLI, project);
}
