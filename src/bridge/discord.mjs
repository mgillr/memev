// SPDX-License-Identifier: Apache-2.0
// Discord: Memev runs its own bot, with its own token, in one private channel of the person's own
// server. The channel maps to the bus seat zai@<machine>, so the z.ai bot in the same channel can
// reach the lead. Messages go out with the z.ai bot mentioned (and no one else), and come in only from
// that channel, from the z.ai bot or the paired person. Every other channel and every direct message
// is ignored: the bot asks only for server messages and their content, never for direct messages.
import { RateLimiter, guardedSender, checkDiscordDestination, acceptDiscordMessage, ChatGuardError } from './guards.mjs';
import { readState, writeState, noteStatus } from './state.mjs';
import { now } from '../engine/util.mjs';

export const API = 'https://discord.com/api/v10';
export const GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
// GUILD_MESSAGES (1 << 9) and MESSAGE_CONTENT (1 << 15). Not DIRECT_MESSAGES: a direct message never arrives.
export const INTENTS = (1 << 9) | (1 << 15);
const FATAL_CLOSE = new Set([4004, 4010, 4011, 4012, 4013, 4014]); // bad token, shard or intents: reconnecting cannot help
const MAX_CONTENT = 2000;

export const discordMention = (userId) => `<@${userId}>`;
/** The body of a post to the paired channel: the z.ai bot mentioned first, and only it may be pinged. */
export function discordOutbound(paired, text) {
  const head = paired?.zai_user_id ? `${discordMention(paired.zai_user_id)} ` : '';
  let content = `${head}${text}`;
  if (content.length > MAX_CONTENT) content = `${content.slice(0, MAX_CONTENT - 10)} [cut]`;
  return { content, allowed_mentions: { users: paired?.zai_user_id ? [paired.zai_user_id] : [] } };
}

/** The REST calls the bridge makes, over fetch. The token is never logged. */
export function restTransport(token, { fetchFn = globalThis.fetch } = {}) {
  const call = async (method, route, body) => {
    const res = await fetchFn(`${API}${route}`, { method, headers: { authorization: `Bot ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await res.json(); } catch {}
    if (!res.ok) throw new Error(`discord ${method} ${route.split('/')[1]}: ${res.status} ${String(json?.message || '').slice(0, 200)}`);
    return json;
  };
  return {
    me: () => call('GET', '/users/@me'),
    createMessage: async (channelId, body) => (await call('POST', `/channels/${channelId}/messages`, body))?.id ?? null,
  };
}

/**
 * The gateway: a WebSocket that says hello, is identified with the bot token and INTENTS, keeps a
 * heartbeat, resumes after a drop, and hands each MESSAGE_CREATE to onMessage. WebSocketImpl is
 * injected so tests drive it with a fake.
 */
export class Gateway {
  constructor({ token, onMessage, WebSocketImpl = globalThis.WebSocket, log = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.token = token; this.onMessage = onMessage; this.WS = WebSocketImpl; this.log = log; this.setTimer = setTimer; this.clearTimer = clearTimer;
    this.seq = null; this.session = null; this.resumeUrl = null; this.ws = null; this.beat = null; this.acked = true; this.stopped = false; this.selfId = null;
  }
  start() { this.stopped = false; this._open(GATEWAY); }
  stop() { this.stopped = true; this._clearBeat(); try { this.ws?.close(1000); } catch {} }
  _send(op, d) { this.ws?.send(JSON.stringify({ op, d })); }
  _clearBeat() { if (this.beat) this.clearTimer(this.beat); this.beat = null; }
  _heartbeat(ms) {
    this._clearBeat();
    const tick = () => {
      if (!this.acked) { this.log('no heartbeat ack; reconnecting'); try { this.ws?.close(4000); } catch {} return; }
      this.acked = false; this._send(1, this.seq);
      this.beat = this.setTimer(tick, ms); this.beat?.unref?.();
    };
    this.beat = this.setTimer(tick, Math.floor(ms * Math.random())); this.beat?.unref?.();
  }
  _open(url) {
    if (!this.WS) throw new ChatGuardError('not_available', 'this Node has no WebSocket; Memev needs Node 22 or newer');
    const ws = new this.WS(url); this.ws = ws;
    ws.onmessage = (ev) => { try { this._frame(JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data))); } catch (e) { this.log(`gateway: ${e.message}`); } };
    ws.onclose = (ev) => {
      this._clearBeat();
      if (this.stopped || ws !== this.ws) return;
      if (FATAL_CLOSE.has(ev?.code)) { this.log(`gateway closed for good (${ev.code})`); this.stopped = true; return; }
      const t = this.setTimer(() => { if (!this.stopped) this._open(this.session && this.resumeUrl ? `${this.resumeUrl}?v=10&encoding=json` : GATEWAY); }, 2000); t?.unref?.();
    };
  }
  _frame(p) {
    if (p.s != null) this.seq = p.s;
    if (p.op === 10) {
      this.acked = true; this._heartbeat(p.d.heartbeat_interval);
      if (this.session) this._send(6, { token: this.token, session_id: this.session, seq: this.seq });
      else this._send(2, { token: this.token, intents: INTENTS, properties: { os: process.platform, browser: 'memev', device: 'memev' } });
    } else if (p.op === 11) this.acked = true;
    else if (p.op === 1) this._send(1, this.seq);
    else if (p.op === 7) { try { this.ws.close(4000); } catch {} }
    else if (p.op === 9) { if (!p.d) { this.session = null; this.seq = null; } try { this.ws.close(4000); } catch {} }
    else if (p.op === 0) {
      if (p.t === 'READY') { this.session = p.d.session_id; this.resumeUrl = p.d.resume_gateway_url; this.selfId = p.d.user?.id || null; }
      if (p.t === 'MESSAGE_CREATE') this.onMessage(p.d);
    }
  }
}

/** Check a bot token with GET /users/@me and store it (0600). */
export async function setupDiscord(root, token, { rest = restTransport(token) } = {}) {
  if (!/^[A-Za-z0-9._-]{50,100}$/.test(String(token || ''))) throw new ChatGuardError('bad_request', 'that does not look like a Discord bot token');
  const me = await rest.me();
  if (!me?.bot) throw new ChatGuardError('bad_request', 'Discord did not confirm that token as a bot');
  writeState(root, 'discord', 'config', { token, bot_user_id: me.id, bot_name: me.username, set: now() });
  return { bot_user_id: me.id, bot_name: me.username };
}

export class DiscordPlugin {
  constructor({ root, rest = null, makeGateway = null, limit = 30, clock = Date.now, log = () => {} }) {
    this.channel = 'discord'; this.root = root; this.log = log;
    const cfg = readState(root, 'discord', 'config');
    if (!cfg?.token) throw new ChatGuardError('not_set_up', 'Discord is not set up');
    this.selfId = cfg.bot_user_id || null;
    this.rest = rest || restTransport(cfg.token);
    this.gateway = (makeGateway || ((o) => new Gateway(o)))({ token: cfg.token, onMessage: (m) => this.inbound(m).catch((e) => this.log(`discord inbound: ${e.message}`)), log });
    this.onInbound = async () => {};
    this.limiter = new RateLimiter({ max: limit, now: clock });
    this.sendTo = guardedSender({
      check: (channelId) => checkDiscordDestination(channelId, this.paired()),
      limiter: this.limiter,
      transport: (channelId, text) => this.rest.createMessage(channelId, discordOutbound(this.paired(), text)),
      onRefuse: (e) => { this.log(`discord send ${e.code}`); noteStatus(root, 'discord', { last_refusal: { at: now(), code: e.code, message: e.message } }); },
    });
  }
  paired() { return readState(this.root, 'discord', 'paired'); }
  send(text) { return this.sendTo(this.paired()?.channel_id, text); }
  async inbound(msg) {
    const m = acceptDiscordMessage(msg, this.paired(), this.selfId || this.gateway.selfId, this.sendTo.sentIds);
    if (!m) return null; // another channel, a direct message, another sender or its own post: nothing is kept
    await this.onInbound({ text: m.text, sender: m.by === 'zai' ? 'the z.ai bot' : 'the person' });
    return m;
  }
  async start() { this.gateway.start(); }
  async stop() { this.gateway.stop(); }
}
