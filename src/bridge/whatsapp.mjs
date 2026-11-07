// SPDX-License-Identifier: Apache-2.0
// WhatsApp: an unofficial connection, as a linked device of the person's own account (the same way
// WhatsApp on a computer is linked). Off by default, and only after the person accepts the warning.
// Memev only messages the person, in their own "message yourself" chat, and only acts on what the
// person writes there. The guards are in guards.mjs; this file only wires them to the library.
import { RateLimiter, guardedSender, checkWhatsAppDestination, acceptWhatsAppInbound, whatsappSelf, isSelfChat, narrowSocket, ChatGuardError } from './guards.mjs';
import { privateAuthState, savedCreds, removeAuth } from './whatsapp-auth.mjs';
import { loadBaileys } from './whatsapp-install.mjs';
import { noteStatus, readState } from './state.mjs';
import { now } from '../engine/util.mjs';

export const WHATSAPP_WARNING = 'This uses an unofficial WhatsApp connection. WhatsApp\'s terms do not allow it, and WhatsApp could suspend this number. Memev only messages you, in your own chat.';

/** A logger the library accepts that writes nothing: the library's own logs could carry message text and numbers. */
const quiet = { level: 'silent', child() { return quiet; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };

/**
 * The socket settings. Every guard that the library itself can carry is set here:
 * - shouldIgnoreJid drops, before any processing, every node from a chat that is not the own chat:
 *   no event, no receipt to the sender (the library still answers the server's delivery ack, as
 *   every linked device must);
 * - syncFullHistory off, so the phone is never asked for the full history;
 * - markOnlineOnConnect off, so the phone still gets its notifications and no presence is sent;
 * - emitOwnEvents off, so Memev's own sends do not come back as events (the sent-id check is the second guard).
 */
export function socketConfig(lib, auth, self) {
  return {
    auth: auth.state,
    logger: quiet,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    emitOwnEvents: false,
    generateHighQualityLinkPreview: false,
    shouldIgnoreJid: (jid) => !isSelfChat(jid, self()),
    getMessage: async () => undefined,
    browser: lib.Browsers?.macOS ? lib.Browsers.macOS('Desktop') : undefined,
  };
}

export function whatsappLinked(root) { return !!whatsappSelf(savedCreds(root)); }

export class WhatsAppPlugin {
  constructor({ root, load = () => loadBaileys(root), limit = 30, clock = Date.now, log = () => {}, reconnectMs = 5000 }) {
    this.channel = 'whatsapp'; this.root = root; this.load = load; this.log = log; this.reconnectMs = reconnectMs;
    this.onInbound = async () => {};
    this.sock = null; this.stopped = false; this.self = null;
    this.limiter = new RateLimiter({ max: limit, now: clock });
    // the one way out: only the own chat, at most `limit` an hour, one message at a time
    this.sendTo = guardedSender({
      check: (jid) => checkWhatsAppDestination(jid, this.self),
      limiter: this.limiter,
      transport: async (jid, text) => {
        if (!this.sock) throw new ChatGuardError('not_connected', 'WhatsApp is not connected');
        return (await this.sock.sendMessage(jid, { text }))?.key?.id ?? null;
      },
      onRefuse: (e) => { this.log(`whatsapp send ${e.code}`); noteStatus(root, 'whatsapp', { last_refusal: { at: now(), code: e.code, message: e.message } }); },
    });
  }
  /** Send to the person's own chat. The destination is never taken from a message: it is always the own account. */
  send(text) { return this.sendTo(this.self?.jid, text); }

  /** A messages.upsert batch: only new messages ('notify'), only the own chat, only what the person wrote. */
  async inbound({ messages, type } = {}) {
    if (type !== 'notify') return 0; // history and appended messages are not new: nothing is kept
    let n = 0;
    for (const msg of messages || []) {
      const m = acceptWhatsAppInbound(msg, this.self, this.sendTo.sentIds);
      if (!m) continue;
      n++;
      await this.onInbound({ text: m.text, sender: 'the person, in their own chat' });
    }
    return n;
  }

  async start() {
    this.stopped = false;
    const lib = await this.load();
    await this._connect(lib);
  }
  async _connect(lib) {
    const auth = privateAuthState(this.root, lib);
    this.self = whatsappSelf(auth.state.creds);
    if (!this.self) throw new ChatGuardError('not_linked', 'WhatsApp is not linked: memev chat whatsapp link');
    const make = lib.makeWASocket || lib.default;
    const sock = narrowSocket(make(socketConfig(lib, auth, () => this.self)));
    this.sock = sock;
    sock.ev.on('creds.update', () => { auth.saveCreds().catch((e) => this.log(`whatsapp creds: ${e.message}`)); });
    sock.ev.on('messages.upsert', (u) => { this.inbound(u).catch((e) => this.log(`whatsapp inbound: ${e.code || e.message}`)); });
    sock.ev.on('connection.update', (u) => {
      if (u.connection === 'open') noteStatus(this.root, 'whatsapp', { connected: now(), error: null });
      if (u.connection !== 'close' || this.stopped) return;
      const code = u.lastDisconnect?.error?.output?.statusCode;
      this.sock = null;
      if (code === lib.DisconnectReason?.loggedOut) {
        // the person removed this linked device on the phone: forget it here too
        removeAuth(this.root); this.self = null;
        noteStatus(this.root, 'whatsapp', { error: 'unlinked from the phone; memev chat whatsapp link to link again' });
        return;
      }
      noteStatus(this.root, 'whatsapp', { error: `disconnected (${code ?? 'unknown'}); reconnecting` });
      const t = setTimeout(() => { if (!this.stopped) this._connect(lib).catch((e) => this.log(`whatsapp reconnect: ${e.message}`)); }, this.reconnectMs); t.unref?.();
    });
  }
  /** Stop. With logout (the person turned WhatsApp off) the linked device is also removed from the account. */
  async stop({ logout = false } = {}) {
    this.stopped = true;
    const sock = this.sock; this.sock = null;
    if (logout && sock?.logout) { try { await sock.logout(); } catch (e) { this.log(`whatsapp logout: ${e.message}`); } }
    try { sock?.end?.(undefined); } catch {}
  }
}

/**
 * Link this computer as a device of the person's account. onCode({ qr }) is called with each QR
 * string to show (or { pairing_code } when a phone number was given). Resolves once linked. The
 * socket used for linking acts on nothing it receives and is closed at the end.
 */
export async function linkWhatsApp(root, { load = () => loadBaileys(root), onCode = () => {}, phone = null, timeoutMs = 180e3, log = () => {} } = {}) {
  const lib = await load();
  const make = lib.makeWASocket || lib.default;
  let asked = false;
  const attempt = () => new Promise((resolve, reject) => {
    const auth = privateAuthState(root, lib);
    const sock = narrowSocket(make({ ...socketConfig(lib, auth, () => whatsappSelf(auth.state.creds)), shouldIgnoreJid: () => true }));
    sock.ev.on('creds.update', () => { auth.saveCreds().catch((e) => log(e.message)); });
    sock.ev.on('connection.update', async (u) => {
      if (u.qr) {
        if (phone && !asked) {
          asked = true;
          try { onCode({ pairing_code: await sock.requestPairingCode(String(phone).replace(/\D/g, '')) }); } catch (e) { reject(e); }
        } else if (!phone) onCode({ qr: u.qr });
      }
      if (u.connection === 'open') { await auth.saveCreds(); try { sock.end(undefined); } catch {} resolve('open'); }
      if (u.connection === 'close') {
        const code = u.lastDisconnect?.error?.output?.statusCode;
        if (code === lib.DisconnectReason?.restartRequired) resolve('restart'); // expected once, right after the scan
        else reject(new Error(`WhatsApp closed the link (${code ?? 'unknown'})`));
      }
    });
  });
  const until = Date.now() + timeoutMs;
  for (let i = 0; i < 3 && Date.now() < until; i++) {
    const r = await Promise.race([attempt(), new Promise((_, rej) => { const t = setTimeout(() => rej(new Error('timed out waiting for the scan')), Math.max(1, until - Date.now())); t.unref?.(); })]);
    if (r === 'open') break; // 'restart': connect once more with the saved credentials
  }
  if (!whatsappLinked(root)) throw new Error('WhatsApp was not linked');
  noteStatus(root, 'whatsapp', { linked: now() });
  return { linked: true };
}

export const whatsappEnabled = (root) => !!readState(root, 'whatsapp', 'enabled')?.accepted_warning;
