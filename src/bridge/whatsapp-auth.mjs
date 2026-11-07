// SPDX-License-Identifier: Apache-2.0
// The linked device's auth state: its credentials and its signal keys, one 0600 file each in
// .memev/chat/whatsapp/auth/ (0700). Written here rather than with the library's own folder helper,
// which writes files with the default mode. Never committed, never synced, never sent anywhere.
import fs from 'node:fs';
import path from 'node:path';
import { readPrivate, writePrivate } from '../engine/util.mjs';
import { channelDir, ensureChannelDir } from './state.mjs';

export const authDir = (root) => path.join(channelDir(root, 'whatsapp'), 'auth');
const fileFor = (name) => `${String(name).replace(/[^A-Za-z0-9._-]/g, '_')}.json`;

/** Read the saved credentials only (no library needed): what `memev chat status` shows as linked. */
export function savedCreds(root) {
  const text = readPrivate(path.join(authDir(root), 'creds.json'));
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * The { state, saveCreds } the library expects. lib supplies initAuthCreds, BufferJSON and proto
 * from the library itself, so the encoding is the library's own.
 */
export function privateAuthState(root, lib) {
  const { initAuthCreds, BufferJSON, proto } = lib;
  ensureChannelDir(root, 'whatsapp');
  const dir = authDir(root);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); try { fs.chmodSync(dir, 0o700); } catch {}
  const read = (name) => { const t = readPrivate(path.join(dir, fileFor(name))); if (t == null) return null; try { return JSON.parse(t, BufferJSON.reviver); } catch { return null; } };
  const write = (name, value) => writePrivate(path.join(dir, fileFor(name)), JSON.stringify(value, BufferJSON.replacer));
  const remove = (name) => fs.rmSync(path.join(dir, fileFor(name)), { force: true });
  const creds = read('creds') || initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const out = {};
          for (const id of ids) {
            let v = read(`${type}-${id}`);
            if (type === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v);
            out[id] = v;
          }
          return out;
        },
        set: async (data) => {
          for (const type of Object.keys(data)) for (const id of Object.keys(data[type])) { const v = data[type][id]; if (v) write(`${type}-${id}`, v); else remove(`${type}-${id}`); }
        },
      },
    },
    saveCreds: async () => write('creds', creds),
  };
}
/** Remove the auth state: the device is unlinked on this computer. */
export function removeAuth(root) { fs.rmSync(authDir(root), { recursive: true, force: true }); }
