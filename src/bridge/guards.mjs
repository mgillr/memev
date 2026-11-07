// SPDX-License-Identifier: Apache-2.0
// The chat bridge's hard guards, in one place. Memev only ever messages the person, and only the
// person (or, for Lark, the one paired chat) ever reaches the lead. Every outbound message of every
// channel goes through guardedSender(); every inbound event goes through one accept function. These
// are pure functions with no library in them, so each guard is tested on its own.
import crypto from 'node:crypto';

export class ChatGuardError extends Error {
  constructor(code, message) { super(message); this.code = code; this.name = 'ChatGuardError'; }
}

// ---- WhatsApp addresses
// A WhatsApp address (JID) is user[:device]@server. The servers that matter here:
//   s.whatsapp.net  a person, by phone number     lid        a person, by hidden id
//   g.us            a group                       broadcast  a broadcast list; status@broadcast is Status
//   newsletter      a channel
/** { user, device, server } for a JID, or null when it is not one. */
export function decodeJid(jid) {
  if (typeof jid !== 'string') return null;
  const at = jid.indexOf('@');
  if (at < 0) return null;
  const server = jid.slice(at + 1);
  const [agentUser, device] = jid.slice(0, at).split(':');
  const user = agentUser.split('_')[0];
  return { user, device: device === undefined ? null : Number(device), server };
}
/** What kind of address a JID is: user, lid, group, status, broadcast, newsletter or other. */
export function classifyJid(jid) {
  if (jid === 'status@broadcast') return 'status';
  const d = decodeJid(jid);
  if (!d) return 'other';
  if (d.server === 'g.us') return 'group';
  if (d.server === 'broadcast') return 'broadcast';
  if (d.server === 'newsletter') return 'newsletter';
  if (d.server === 's.whatsapp.net') return 'user';
  if (d.server === 'lid') return 'lid';
  return 'other';
}
/**
 * The person's own account, from the linked device's auth state (creds.me): the user part of the
 * phone-number JID and of the hidden id, without the device part. Null before the device is linked.
 */
export function whatsappSelf(creds) {
  const pn = decodeJid(creds?.me?.id);
  if (!pn || pn.server !== 's.whatsapp.net' || !/^\d{5,20}$/.test(pn.user)) return null;
  const lid = decodeJid(creds?.me?.lid);
  return { pnUser: pn.user, lidUser: lid && lid.server === 'lid' ? lid.user : null, jid: `${pn.user}@s.whatsapp.net` };
}
/** True when a chat address is the person's own "message yourself" chat. */
export function isSelfChat(jid, self) {
  if (!self) return false;
  const d = decodeJid(jid);
  if (!d) return false;
  if (d.server === 's.whatsapp.net') return d.user === self.pnUser;
  if (d.server === 'lid') return !!self.lidUser && d.user === self.lidUser;
  return false;
}
/**
 * Guard a: the only destination is the person's own chat, exactly `<own number>@s.whatsapp.net`.
 * Another person, a group, a broadcast list, Status, a channel, a device-qualified or malformed
 * address: each is refused with a reason.
 */
export function checkWhatsAppDestination(jid, self) {
  if (!self) throw new ChatGuardError('not_linked', 'refused: WhatsApp is not linked, so there is no own chat to send to');
  const kind = classifyJid(jid);
  if (kind !== 'user') throw new ChatGuardError(`refused_${kind}`, `refused: ${kind === 'other' ? 'not a WhatsApp person address' : `a ${kind} address`}; Memev only messages your own chat`);
  if (jid !== self.jid) throw new ChatGuardError('refused_other_user', 'refused: another person\'s chat; Memev only messages your own chat');
  return jid;
}
/** The text of a WhatsApp message, or null when it carries none (media, reactions, invites, protocol messages). */
export function whatsappText(message) {
  const m = message?.message;
  if (!m) return null;
  const t = typeof m.conversation === 'string' ? m.conversation : typeof m.extendedTextMessage?.text === 'string' ? m.extendedTextMessage.text : null;
  return t && t.trim() ? t : null;
}
/**
 * Guard b: act only on a message in the own chat that the person wrote (it carries fromMe, since
 * the person's phone is the same account) and that Memev did not send itself. Anything else, from
 * any other chat, group, Status or broadcast, returns null and is dropped without a trace.
 */
export function acceptWhatsAppInbound(msg, self, sentIds) {
  const key = msg?.key;
  if (!key || typeof key.id !== 'string') return null;
  if (key.participant || key.participantAlt) return null; // only group and broadcast messages name a participant
  if (!isSelfChat(key.remoteJid, self)) return null;
  if (key.remoteJidAlt && !isSelfChat(key.remoteJidAlt, self)) return null;
  if (key.fromMe !== true) return null;
  if (sentIds?.has(key.id)) return null; // Memev's own message coming back: no loop
  const text = whatsappText(msg);
  return text ? { id: key.id, text } : null;
}

/**
 * Guard c, d and no receipts: the socket the WhatsApp plugin holds has only what the bridge needs.
 * No group call (create, join, accept an invite, add, remove or leave, metadata), no read receipts,
 * no presence, no contact or history fetch can be made through it: none of them exist on it.
 */
export const WHATSAPP_SOCKET_USES = ['sendMessage', 'requestPairingCode', 'end', 'logout'];
export function narrowSocket(sock) {
  const out = { ev: { on: (name, fn) => { if (!WHATSAPP_EVENTS.includes(name)) throw new ChatGuardError('refused_event', `refused: the bridge does not listen to ${name}`); sock.ev.on(name, fn); } } };
  for (const k of WHATSAPP_SOCKET_USES) if (typeof sock[k] === 'function') out[k] = sock[k].bind(sock);
  return Object.freeze(out);
}
/** The only events the bridge listens to: its link state, its own credentials, and new messages (filtered by guard b). Groups, contacts, chats, history and presence are not among them. */
export const WHATSAPP_EVENTS = ['connection.update', 'creds.update', 'messages.upsert'];

// ---- Telegram
/** Guard: send only to the paired private chat. A group, supergroup or channel id is negative; the pairing holds one positive id. */
export function checkTelegramDestination(chatId, paired) {
  if (!paired || !Number.isSafeInteger(paired.chat_id) || paired.chat_id <= 0) throw new ChatGuardError('not_paired', 'refused: Telegram is not paired');
  if (chatId !== paired.chat_id) throw new ChatGuardError('refused_other_chat', 'refused: not the paired chat; Memev only messages the person it is paired with');
  return chatId;
}
/** The message of an update when it is a private text from the paired person, else null. Groups, channels, bots and anyone else are dropped. */
export function acceptTelegramUpdate(update, paired) {
  const m = update?.message;
  if (!m || !paired) return null;
  if (m.chat?.type !== 'private') return null;
  if (!m.from || m.from.is_bot) return null;
  if (m.from.id !== paired.user_id || m.chat.id !== paired.chat_id) return null;
  if (typeof m.text !== 'string' || !m.text.trim()) return null;
  return { id: m.message_id, text: m.text };
}
/** A /start <code> sent privately by a person, before pairing: the candidate pairing, else null. */
export function telegramStartCode(update) {
  const m = update?.message;
  if (!m || m.chat?.type !== 'private' || !m.from || m.from.is_bot) return null;
  const hit = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{1,64})\s*$/.exec(String(m.text || ''));
  return hit ? { code: hit[1], user_id: m.from.id, chat_id: m.chat.id } : null;
}

// ---- Lark
/** Guard: send only to the one paired chat. */
export function checkLarkDestination(chatId, paired) {
  if (!paired?.chat_id) throw new ChatGuardError('not_paired', 'refused: Lark is not paired with a chat');
  if (chatId !== paired.chat_id) throw new ChatGuardError('refused_other_chat', 'refused: not the paired Lark chat');
  return chatId;
}
/**
 * An im.message.receive_v1 event when it is a text in the paired chat from the z.ai bot or the paired
 * person, and not one this app sent: { id, text, by: 'zai' | 'person' }, else null.
 */
export function acceptLarkEvent(event, paired, sentIds) {
  const msg = event?.message; const sender = event?.sender;
  if (!msg || !sender || !paired?.chat_id) return null;
  if (msg.chat_id !== paired.chat_id) return null;
  if (sentIds?.has(msg.message_id)) return null;
  const openId = sender.sender_id?.open_id;
  if (!openId) return null;
  if (paired.self_open_id && openId === paired.self_open_id) return null; // this app's own bot
  const by = paired.zai_open_id && openId === paired.zai_open_id ? 'zai' : paired.person_open_id && openId === paired.person_open_id ? 'person' : null;
  if (!by) return null;
  if (msg.message_type !== 'text') return null;
  let text; try { text = JSON.parse(msg.content).text; } catch { return null; }
  if (typeof text !== 'string' || !text.trim()) return null;
  return { id: msg.message_id, text, by };
}

// ---- rate limit
/** Guard e: at most `max` messages in any rolling hour (default 30). take() throws when the next would pass it. */
export class RateLimiter {
  constructor({ max = 30, windowMs = 3600e3, now = Date.now } = {}) {
    if (!Number.isInteger(max) || max < 1) throw new ChatGuardError('bad_request', 'the hourly message limit must be a whole number of 1 or more');
    this.max = max; this.windowMs = windowMs; this.now = now; this.sent = [];
  }
  _trim() { const t = this.now(); while (this.sent.length && this.sent[0] <= t - this.windowMs) this.sent.shift(); return t; }
  left() { this._trim(); return this.max - this.sent.length; }
  take() {
    const t = this._trim();
    if (this.sent.length >= this.max) throw new ChatGuardError('rate_limited', `refused: the limit of ${this.max} messages an hour is reached`);
    this.sent.push(t);
  }
}

/**
 * The one way out for a channel. check(dest) throws on any destination but the allowed one, the
 * limiter throws past the hourly limit, and only then does transport(dest, text) run, one message
 * per call (no bulk). A refusal is logged through onRefuse and raised; it is never retried.
 * transport returns the id of the sent message, which is remembered so inbound can drop it.
 */
export function guardedSender({ check, limiter, transport, sentIds = new Set(), onRefuse = () => {}, keep = 500 }) {
  const send = async (dest, text) => {
    try {
      check(dest);
      if (typeof text !== 'string' || !text) throw new ChatGuardError('bad_request', 'refused: one text message at a time');
      limiter.take();
    } catch (e) { onRefuse(e, dest); throw e; }
    const id = await transport(dest, text);
    if (id != null) { sentIds.add(id); if (sentIds.size > keep) sentIds.delete(sentIds.values().next().value); }
    return id;
  };
  send.sentIds = sentIds;
  return send;
}

// ---- pairing codes
const hash = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');
/** A one-time pairing code, valid for ttlMs (10 minutes by default). Only its hash is stored. */
export function newPairingCode({ ttlMs = 10 * 60e3, now = Date.now } = {}) {
  const code = crypto.randomBytes(12).toString('base64url');
  return { code, stored: { code_sha256: hash(code), expires: new Date(now() + ttlMs).toISOString() } };
}
/** True when code matches a stored pairing that has not expired. The caller deletes it once used. */
export function pairingMatches(stored, code, { now = Date.now } = {}) {
  if (!stored?.code_sha256 || !stored.expires || typeof code !== 'string') return false;
  if (now() >= Date.parse(stored.expires)) return false;
  const a = Buffer.from(stored.code_sha256, 'hex'); const b = Buffer.from(hash(code), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
