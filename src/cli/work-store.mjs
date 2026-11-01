// The production port of memev work impact: openStore(project, { root }) returns a read-only view of the project of the vault at
// root, or null when that project has nothing recorded. The view has one function that reads a kind of record and returns a copy;
// it has no write method and does not hand out the store. The port reads the project's files and writes nothing, so it is safe to
// run beside the daemon: it opens no vault, takes no lock and creates nothing. The vault is the one door to the project data, so
// the port goes through it.
import { Vault } from '../engine/vault.mjs';

export function openStore(project, { root } = {}) {
  if (!root) throw new Error('openStore needs the vault root');
  return Vault.readProject(root, project);
}
