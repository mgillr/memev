// SPDX-License-Identifier: Apache-2.0
// Where the chat bridge keeps its state: <vault>/.memev/chat/<channel>/, on this computer only. .memev/
// is never committed and never synced, the folders are 0700 and every file is 0600. Nothing here is
// sent anywhere.
import fs from 'node:fs';
import path from 'node:path';
import { readPrivate, writePrivateJson, now } from '../engine/util.mjs';

export const CHANNELS = ['whatsapp', 'telegram', 'discord', 'lark'];
/** The bus seat (app part) each channel uses: whatsapp@<machine>, telegram@<machine>, zai@<machine>. Discord and Lark are two routes for z.ai, so one of them is on at a time. */
export const SEAT_CLIENT = { whatsapp: 'whatsapp', telegram: 'telegram', discord: 'zai', lark: 'zai' };
export const ZAI_ROUTES = ['discord', 'lark'];

export const chatRoot = (root) => path.join(root, '.memev', 'chat');
export function channelDir(root, channel) {
  if (!CHANNELS.includes(channel)) throw new Error(`no chat channel ${channel}; the channels are ${CHANNELS.join(', ')}`);
  return path.join(chatRoot(root), channel);
}
/** Make the channel's folder, 0700 all the way from .memev/chat. */
export function ensureChannelDir(root, channel) {
  const dir = channelDir(root, channel);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const d of [chatRoot(root), dir]) { try { fs.chmodSync(d, 0o700); } catch {} }
  return dir;
}
export function readState(root, channel, name, fallback = null) {
  const text = readPrivate(path.join(channelDir(root, channel), `${name}.json`));
  if (text == null) return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}
export function writeState(root, channel, name, value) {
  ensureChannelDir(root, channel);
  writePrivateJson(path.join(channelDir(root, channel), `${name}.json`), value);
}
export function removeState(root, channel, name) { fs.rmSync(path.join(channelDir(root, channel), `${name}.json`), { force: true }); }
/** Remove everything a channel holds on this computer: credentials, pairing, auth state and the installed library. */
export function removeChannel(root, channel) { fs.rmSync(channelDir(root, channel), { recursive: true, force: true }); }

/** The status the daemon keeps for `memev chat status`: running, last message in and out, last refusal or error. */
export function noteStatus(root, channel, patch) {
  if (!fs.existsSync(channelDir(root, channel))) return null; // turned off and removed: write nothing back
  const cur = readState(root, channel, 'status', {});
  const next = { ...cur, ...patch, updated: now() };
  try { writeState(root, channel, 'status', next); } catch {}
  return next;
}
