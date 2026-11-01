// SPDX-License-Identifier: Apache-2.0
// Whether a folder is a Memev vault, without loading the vault engine. The hooks ask this before every turn, so it
// imports only Node built-ins, not the oplog, the index, git and the rest of vault.mjs; vault.mjs re-exports both names.
import fs from 'node:fs';
import path from 'node:path';

export const STATE = '.memev';
// the same test as util.mjs exists(): the config file can be reached
export function isVault(root) { try { fs.accessSync(path.join(root, STATE, 'config.json')); return true; } catch { return false; } }
