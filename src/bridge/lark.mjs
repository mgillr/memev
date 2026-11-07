// SPDX-License-Identifier: Apache-2.0
// Lark: the route by which z.ai reaches Memev. The person runs a self-built Lark app with a bot, and
// connects chat.z.ai's own Lark connector to the same Lark account. The bridge maps ONE Lark chat
// to the bus seat zai@<machine>: inbound only from that chat, and only from the z.ai bot or the
// paired person; outbound only to that chat, with the z.ai bot mentioned so it answers. It never
// creates or joins a chat.
//
// The Lark connection itself is a transport behind a small interface, so setup can move to another
// tool later without touching the guards:
//   transport.start(onEvent)                  deliver each im.message.receive_v1 event body to onEvent(event)
//   transport.sendText(chatId, text, { as })  -> message_id; as is 'bot' (the default) or 'user'
//   transport.listMessages(chatId, { since }) -> [{ message_id, sender: { id, sender_type }, msg_type, body: { content } }]
//   transport.stop()
// The real transport keeps the tenant token fresh (it lasts about two hours) and always addresses the
// chat by chat_id. No real transport is built yet; createTransport must be given. Tests use a fake.
//
// On Lark international, im.message.receive_v1 carries only messages people send, not those of
// another bot. So the z.ai bot's replies can also be read by polling the chat's history, behind the
// read_history setting. Each poll is a billed basic API call (the free plan has 10,000 a month for the
// whole tenant), so polling runs at most once every poll_minutes (default 10), counts its calls by
// month and stops at the monthly budget (default 3,000) or when Lark answers 99991403 or 429.
import { RateLimiter, guardedSender, checkLarkDestination, acceptLarkEvent, ChatGuardError } from './guards.mjs';
import { readState, writeState, noteStatus } from './state.mjs';
import { now } from '../engine/util.mjs';

/** A mention in a Lark text message. */
export const larkMention = (openId) => `<at user_id="${openId}"></at>`;
/** The text sent to the paired chat: the z.ai bot mentioned first, so it is triggered. */
export const larkOutboundText = (paired, text) => (paired?.zai_open_id ? `${larkMention(paired.zai_open_id)} ${text}` : text);

const month = (t) => new Date(t).toISOString().slice(0, 7);
export const QUOTA_ERRORS = new Set([99991403, 429]);

export class LarkPlugin {
  constructor({ root, createTransport = null, limit = 30, clock = Date.now, log = () => {}, setTimer = setInterval, clearTimer = clearInterval }) {
    this.channel = 'lark'; this.root = root; this.log = log; this.clock = clock; this.setTimer = setTimer; this.clearTimer = clearTimer;
    if (!createTransport) throw new ChatGuardError('not_available', 'the Lark connection is not built yet');
    this.config = readState(root, 'lark', 'config') || {};
    this.sendAs = this.config.send_as === 'user' ? 'user' : 'bot';
    this.transport = createTransport(this.config);
    this.seen = new Set(); this.pollTimer = null; this.lastPoll = 0;
    this.onInbound = async () => {};
    this.limiter = new RateLimiter({ max: limit, now: clock });
    this.sendTo = guardedSender({
      check: (chatId) => checkLarkDestination(chatId, this.paired()),
      limiter: this.limiter,
      transport: (chatId, text) => this.transport.sendText(chatId, larkOutboundText(this.paired(), text), { as: this.sendAs }),
      onRefuse: (e) => { this.log(`lark send ${e.code}`); noteStatus(root, 'lark', { last_refusal: { at: now(), code: e.code, message: e.message } }); },
    });
  }
  paired() { return readState(this.root, 'lark', 'paired'); }
  send(text) { return this.sendTo(this.paired()?.chat_id, text); }
  async inbound(event) {
    const m = acceptLarkEvent(event, this.paired(), this.sendTo.sentIds);
    if (!m) return null; // another chat, another sender, or this app's own message: nothing is kept
    if (this.seen.has(m.id)) return null; // the same message twice (an event and a history poll): once only
    this.seen.add(m.id); if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value);
    await this.onInbound({ text: m.text, sender: m.by === 'zai' ? 'the z.ai bot' : 'the person' });
    return m;
  }
  /** The month's history-poll count and whether polling is paused: shown by memev chat status. */
  quota() {
    const q = readState(this.root, 'lark', 'quota', {}) || {};
    return q.month === month(this.clock()) ? q : { month: month(this.clock()), calls: 0, paused: null };
  }
  /** One history poll, when read_history is on, the interval has passed and the month's budget allows. Returns the messages passed on, or null when it did not poll. */
  async pollHistory() {
    if (!this.config.read_history || !this.transport.listMessages) return null;
    const p = this.paired(); if (!p?.chat_id) return null;
    const t = this.clock(); const everyMs = Math.max(1, Number(this.config.poll_minutes) || 10) * 60e3;
    if (t - this.lastPoll < everyMs) return null;
    const q = this.quota(); const budget = Number(this.config.monthly_budget) || 3000;
    if (q.paused || q.calls >= budget) { noteStatus(this.root, 'lark', { history: { ...q, budget, paused: q.paused || 'the monthly budget is used' } }); return null; }
    this.lastPoll = t; q.calls++;
    let items;
    try { items = await this.transport.listMessages(p.chat_id, { since: q.since || null }); }
    catch (e) {
      if (QUOTA_ERRORS.has(e.code) || QUOTA_ERRORS.has(e.status)) q.paused = `Lark refused (${e.code || e.status}); polling waits for next month`;
      writeState(this.root, 'lark', 'quota', q); noteStatus(this.root, 'lark', { history: { ...q, budget } });
      return null;
    }
    let n = 0;
    for (const it of items || []) {
      const event = { sender: { sender_id: { open_id: it.sender?.id }, sender_type: it.sender?.sender_type }, message: { message_id: it.message_id, chat_id: p.chat_id, message_type: it.msg_type, content: it.body?.content } };
      if (await this.inbound(event)) n++;
      if (it.create_time && (!q.since || it.create_time > q.since)) q.since = it.create_time;
    }
    writeState(this.root, 'lark', 'quota', q); noteStatus(this.root, 'lark', { history: { ...q, budget } });
    return n;
  }
  async start() {
    await this.transport.start((e) => this.inbound(e).catch((err) => this.log(`lark inbound: ${err.message}`)));
    if (this.config.read_history) { this.pollTimer = this.setTimer(() => { this.pollHistory().catch((e) => this.log(`lark history: ${e.message}`)); }, 60e3); this.pollTimer?.unref?.(); }
  }
  async stop() { if (this.pollTimer) this.clearTimer(this.pollTimer); this.pollTimer = null; await this.transport.stop?.(); }
}
