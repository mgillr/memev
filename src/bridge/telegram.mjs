// SPDX-License-Identifier: Apache-2.0
// Telegram: a bot the person made with BotFather, reached over the Bot API with HTTPS long polling,
// so no public address is needed. The bot answers one person: the one who opened the one-time
// pairing link. Anyone else, any group and any channel gets nothing, not even a reply.
import { RateLimiter, guardedSender, checkTelegramDestination, acceptTelegramUpdate, telegramStartCode, pairingMatches, newPairingCode, ChatGuardError } from './guards.mjs';
import { readState, writeState, removeState, noteStatus } from './state.mjs';
import { now } from '../engine/util.mjs';

export const API_HOST = 'https://api.telegram.org';
const LONG_POLL_S = 25;

/** A token as BotFather gives it: <bot id>:<secret>. */
export const TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;

/**
 * The Bot API over fetch. The token is in the URL path, so no URL and no response body is ever
 * logged; an error carries the method and Telegram's description only.
 */
export function fetchTransport(token, { fetchFn = globalThis.fetch } = {}) {
  return {
    async call(method, params = {}, { signal } = {}) {
      const res = await fetchFn(`${API_HOST}/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), signal });
      let json = null; try { json = await res.json(); } catch {}
      if (!json?.ok) { const e = new Error(`telegram ${method}: ${String(json?.description || res.status).slice(0, 200)}`); e.status = res.status; throw e; }
      return json.result;
    },
  };
}

export const pairLink = (username, code) => `https://t.me/${username}?start=${code}`;

/** Check a token with getMe and store it (0600). Returns the bot's username. */
export async function setupTelegram(root, token, { transport = fetchTransport(token) } = {}) {
  if (!TOKEN_RE.test(String(token || ''))) throw new ChatGuardError('bad_request', 'that does not look like a bot token from BotFather (digits, a colon, then letters and digits)');
  const me = await transport.call('getMe');
  if (!me?.is_bot || !me.username) throw new ChatGuardError('bad_request', 'Telegram did not confirm that token as a bot');
  writeState(root, 'telegram', 'config', { token, bot_id: me.id, bot_username: me.username, set: now() });
  return { bot_username: me.username };
}
/** A one-time pairing code, valid for ttlMs, as a t.me deep link. Only its hash is stored. */
export function startPairing(root, { ttlMs = 10 * 60e3, clock = Date.now } = {}) {
  const cfg = readState(root, 'telegram', 'config');
  if (!cfg?.token) throw new ChatGuardError('not_set_up', 'Telegram is not set up: memev chat telegram setup --token <token from BotFather>');
  const { code, stored } = newPairingCode({ ttlMs, now: clock });
  writeState(root, 'telegram', 'pairing', stored);
  return { link: pairLink(cfg.bot_username, code), expires: stored.expires, code };
}

export class TelegramPlugin {
  constructor({ root, transport = null, limit = 30, clock = Date.now, log = () => {} }) {
    this.channel = 'telegram'; this.root = root; this.clock = clock; this.log = log;
    const cfg = readState(root, 'telegram', 'config');
    if (!cfg?.token) throw new ChatGuardError('not_set_up', 'Telegram is not set up');
    this.transport = transport || fetchTransport(cfg.token);
    this.offset = readState(root, 'telegram', 'offset', {})?.next || 0;
    this.onInbound = async () => {};
    this.limiter = new RateLimiter({ max: limit, now: clock });
    // the one way out: only the paired chat, at most `limit` an hour
    this.sendTo = guardedSender({
      check: (chatId) => checkTelegramDestination(chatId, this.paired()),
      limiter: this.limiter,
      transport: async (chatId, text) => (await this.transport.call('sendMessage', { chat_id: chatId, text }))?.message_id ?? null,
      onRefuse: (e) => { this.log(`telegram send ${e.code}`); noteStatus(root, 'telegram', { last_refusal: { at: now(), code: e.code, message: e.message } }); },
    });
    this.running = false; this.abort = null; this.loop = null;
  }
  paired() { return readState(this.root, 'telegram', 'paired'); }
  send(text) { const p = this.paired(); return this.sendTo(p?.chat_id, text); }

  /** One update. Before pairing only a valid /start <code> in a private chat counts; after it only the paired person. */
  async inbound(update) {
    const paired = this.paired();
    if (!paired) {
      const start = telegramStartCode(update);
      if (!start || !pairingMatches(readState(this.root, 'telegram', 'pairing'), start.code, { now: this.clock })) return null;
      if (!(start.user_id > 0 && start.chat_id === start.user_id)) return null;
      writeState(this.root, 'telegram', 'paired', { user_id: start.user_id, chat_id: start.chat_id, at: now() });
      removeState(this.root, 'telegram', 'pairing'); // one use
      noteStatus(this.root, 'telegram', { paired_at: now() });
      await this.send('Paired. Messages here go to your Memev lead, and its answers come back here.').catch(() => {});
      return { paired: true };
    }
    const m = acceptTelegramUpdate(update, paired);
    if (!m) return null; // not the paired person: no reply, nothing kept
    await this.onInbound({ text: m.text, sender: 'the person' });
    return m;
  }
  async pollOnce(signal) {
    const updates = await this.transport.call('getUpdates', { offset: this.offset, timeout: LONG_POLL_S, allowed_updates: ['message'] }, { signal });
    for (const u of updates || []) {
      this.offset = Math.max(this.offset, u.update_id + 1);
      try { await this.inbound(u); } catch (e) { this.log(`telegram inbound: ${e.code || e.message}`); }
    }
    if (updates?.length) writeState(this.root, 'telegram', 'offset', { next: this.offset });
    return updates?.length || 0;
  }
  async start() {
    this.running = true;
    this.loop = (async () => {
      let backoff = 1000;
      while (this.running) {
        this.abort = new AbortController();
        try { await this.pollOnce(this.abort.signal); backoff = 1000; }
        catch (e) {
          if (!this.running) break;
          this.log(e.message); noteStatus(this.root, 'telegram', { error: e.message });
          await new Promise((r) => { const t = setTimeout(r, backoff); t.unref?.(); });
          backoff = Math.min(backoff * 2, 60e3);
        }
      }
    })();
  }
  async stop() { this.running = false; try { this.abort?.abort(); } catch {} await this.loop?.catch(() => {}); }
}
