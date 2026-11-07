// SPDX-License-Identifier: Apache-2.0
// `memev chat …`: talk with the lead from a phone. The daemon runs the bridges; these commands turn a
// channel on or off, link or pair it, and show its state. Every command has a --json form for the app.
import { ensureDaemon } from './daemon.mjs';
import { CHANNELS, SEAT_CLIENT, ZAI_ROUTES, channelDir, readState, writeState, removeState, removeChannel } from '../bridge/state.mjs';
import { now } from '../engine/util.mjs';
import fs from 'node:fs';

export const USAGE = `memev chat: talk with your Memev lead from your phone

  memev chat status [--json]                          each channel: on or off, linked or paired, last message in and out
  memev chat telegram setup --token <token>           the token BotFather gave you for your own bot (stored 0600 on this computer)
  memev chat telegram pair [--wait] [--json]          a one-time link (and QR code), valid 10 minutes: open it on your phone
  memev chat telegram unpair | disable [--json]       forget the paired person, or remove Telegram altogether
  memev chat whatsapp enable --accept-risk [--limit N] [--json]
                                                      turn WhatsApp on (off by default; read the warning first)
  memev chat whatsapp link [--phone <number>] [--json]
                                                      show a QR code to scan under WhatsApp > Settings > Linked devices
                                                      (--phone: an 8-character code to type in instead)
  memev chat whatsapp disable | unlink [--json]       log this computer out and remove its WhatsApp state
  memev chat discord setup --token <bot token>        z.ai through Discord: your own bot's token (stored 0600 on this computer)
  memev chat discord pair --guild <server id> --channel <channel id> --zai <z.ai bot user id> [--person <your user id>]
  memev chat discord disable [--json]
  memev chat lark setup --app-id <id> --app-secret <secret> [--send-as bot|user] [--read-history] [--poll-minutes N]
                                                      (the Lark connection is not built yet; see docs/CHAT.md)
  memev chat lark pair --chat <chat_id> --zai <open_id> [--person <open_id>] [--self <open_id>]
  memev chat lark disable [--json]`;

/** The state of each channel, as `memev chat status --json` prints it. */
export async function chatStatus(root) {
  const out = [];
  for (const channel of CHANNELS) {
    const on = fs.existsSync(channelDir(root, channel));
    const st = readState(root, channel, 'status', {}) || {};
    const row = { channel, seat_app: SEAT_CLIENT[channel], on, seat: st.seat || null, running: !!st.running, last_in: st.last_in || null, last_out: st.last_out || null, last_refusal: st.last_refusal || null, error: st.error || null };
    if (channel === 'whatsapp') {
      const { whatsappEnabled, whatsappLinked } = await import('../bridge/whatsapp.mjs');
      const { installedProblem } = await import('../bridge/whatsapp-install.mjs');
      Object.assign(row, { enabled: whatsappEnabled(root), linked: whatsappLinked(root), installed: on && !installedProblem(root) });
    }
    if (channel === 'telegram') { const c = readState(root, 'telegram', 'config'); const p = readState(root, 'telegram', 'paired'); Object.assign(row, { set_up: !!c?.token, bot: c?.bot_username || null, paired: !!p, paired_at: p?.at || null }); }
    if (channel === 'discord') { const c = readState(root, 'discord', 'config'); const p = readState(root, 'discord', 'paired'); Object.assign(row, { set_up: !!c?.token, bot: c?.bot_name || null, paired: !!p, paired_at: p?.at || null }); }
    if (channel === 'lark') { const c = readState(root, 'lark', 'config'); const p = readState(root, 'lark', 'paired'); Object.assign(row, { set_up: !!c, paired: !!p, available: false, send_as: c?.send_as || 'bot', read_history: !!c?.read_history, history: st.history || null }); }
    out.push(row);
  }
  return { channels: out };
}

/** Turn WhatsApp on: only with the warning accepted. Installs the pinned library into this computer's private state. */
export async function enableWhatsApp(root, { accept = false, limit = 30, install = null } = {}) {
  const { WHATSAPP_WARNING } = await import('../bridge/whatsapp.mjs');
  if (!accept) { const e = new Error(`${WHATSAPP_WARNING}\nTo turn it on anyway: memev chat whatsapp enable --accept-risk`); e.code = 'needs_accept'; throw e; }
  const n = Number(limit);
  if (!Number.isInteger(n) || n < 1 || n > 120) { const e = new Error('--limit is the most messages an hour, a whole number from 1 to 120'); e.code = 'bad_request'; throw e; }
  const doInstall = install || (await import('../bridge/whatsapp-install.mjs')).installBaileys;
  const lib = await doInstall(root);
  writeState(root, 'whatsapp', 'enabled', { accepted_warning: WHATSAPP_WARNING, at: now(), limit: n });
  return { enabled: true, limit: n, library: lib?.version || null };
}
/** Remove everything a channel keeps on this computer. The daemon stops its bridge (and logs WhatsApp out) on its next look. */
export function disableChannel(root, channel) {
  const had = fs.existsSync(channelDir(root, channel));
  removeChannel(root, channel);
  return { channel, removed: had };
}

async function waitFor(check, ms, step = 1000) {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (check()) return true; await new Promise((r) => setTimeout(r, step)); }
  return check();
}

export async function command(_cmd, pos, flags, { root }) {
  const [channel, action] = pos;
  const json = !!flags.json;
  const print = (obj, text) => { if (json) console.log(JSON.stringify(obj)); else console.log(text); };
  const fail = (e, code = 1) => { if (json) console.log(JSON.stringify({ ok: false, error: e.code || 'error', message: e.message })); else console.error(e.message); return code; };
  try {
    if (!channel || channel === 'help' || flags.help) { console.log(USAGE); return channel ? 0 : 2; }
    if (channel === 'status') {
      const s = await chatStatus(root);
      if (json) { console.log(JSON.stringify({ ok: true, ...s })); return 0; }
      for (const c of s.channels) {
        const state = !c.on ? 'off' : c.channel === 'whatsapp' ? (c.linked ? 'linked' : c.enabled ? 'on, not linked' : 'not enabled') : c.paired ? 'paired' : c.set_up ? 'set up, not paired' : 'on';
        console.log(`  ${c.channel.padEnd(9)} ${state}${c.running ? ', running' : ''}${c.seat ? ` as ${c.seat}` : ''}${c.last_in ? `, last in ${c.last_in}` : ''}${c.last_out ? `, last out ${c.last_out}` : ''}${c.error ? ` (${c.error})` : ''}`);
      }
      return 0;
    }
    if (!CHANNELS.includes(channel)) { console.error(USAGE); return 2; }
    if (action === 'disable' || (channel === 'whatsapp' && action === 'unlink')) {
      const r = disableChannel(root, channel);
      print({ ok: true, ...r }, r.removed ? `${channel} is off; everything it kept on this computer is removed.${channel === 'whatsapp' ? ' Memev also logs this device out; check WhatsApp > Settings > Linked devices on your phone.' : ''}` : `${channel} was already off.`);
      return 0;
    }
    if (channel === 'whatsapp') {
      if (action === 'enable') {
        if (!flags['accept-risk']) { const { WHATSAPP_WARNING } = await import('../bridge/whatsapp.mjs'); return fail(Object.assign(new Error(`${WHATSAPP_WARNING}\nTo turn it on anyway: memev chat whatsapp enable --accept-risk`), { code: 'needs_accept' }), 2); }
        if (!json) console.log('Installing the WhatsApp connection (pinned, checked against its lockfile)...');
        const r = await enableWhatsApp(root, { accept: true, limit: flags.limit ?? 30 });
        print({ ok: true, ...r }, `WhatsApp is on (at most ${r.limit} messages an hour). Next: memev chat whatsapp link`);
        return 0;
      }
      if (action === 'link') {
        const { whatsappEnabled, whatsappLinked, linkWhatsApp } = await import('../bridge/whatsapp.mjs');
        if (!whatsappEnabled(root)) return fail(Object.assign(new Error('WhatsApp is off: memev chat whatsapp enable --accept-risk first'), { code: 'not_enabled' }), 2);
        if (whatsappLinked(root)) { print({ ok: true, linked: true }, 'WhatsApp is already linked.'); return 0; }
        const { qrText } = await import('../../vendor/qr.mjs');
        await linkWhatsApp(root, {
          phone: flags.phone || null,
          onCode: (c) => {
            if (json) { console.log(JSON.stringify({ ok: true, ...c })); return; }
            if (c.pairing_code) console.log(`On your phone: WhatsApp > Settings > Linked devices > Link a device > Link with phone number instead, then type ${c.pairing_code}`);
            else { console.log('Scan this with your phone: WhatsApp > Settings > Linked devices > Link a device'); try { console.log(qrText(c.qr)); } catch { console.log('(this terminal cannot show the code; use --json and show it in the app, or --phone <number>)'); } }
          },
        });
        print({ ok: true, linked: true }, 'Linked. Write to yourself in WhatsApp ("Message yourself") to reach your lead.');
        await ensureDaemon(root, { quiet: true });
        return 0;
      }
    }
    if (channel === 'telegram') {
      const tg = await import('../bridge/telegram.mjs');
      if (action === 'setup') {
        const token = typeof flags.token === 'string' ? flags.token : process.env.MEMEV_TELEGRAM_TOKEN;
        if (!token) return fail(Object.assign(new Error('give the token BotFather sent you: memev chat telegram setup --token <token>'), { code: 'bad_request' }), 2);
        const r = await tg.setupTelegram(root, token);
        await ensureDaemon(root, { quiet: true });
        print({ ok: true, ...r }, `Telegram bot @${r.bot_username} is set up. Next: memev chat telegram pair`);
        return 0;
      }
      if (action === 'pair') {
        const p = tg.startPairing(root);
        await ensureDaemon(root, { quiet: true });
        if (json) console.log(JSON.stringify({ ok: true, link: p.link, expires: p.expires }));
        else { const { qrText } = await import('../../vendor/qr.mjs'); console.log(`Open this on your phone within 10 minutes and press Start:\n  ${p.link}`); try { console.log(qrText(p.link)); } catch {} }
        if (flags.wait) {
          const ok = await waitFor(() => !!readState(root, 'telegram', 'paired'), 10 * 60e3);
          print({ ok, paired: ok }, ok ? 'Paired.' : 'Not paired in time; run memev chat telegram pair again.');
          return ok ? 0 : 1;
        }
        return 0;
      }
      if (action === 'unpair') { removeState(root, 'telegram', 'paired'); removeState(root, 'telegram', 'pairing'); print({ ok: true, paired: false }, 'Telegram is unpaired; nobody reaches the lead through it until you pair again.'); return 0; }
    }
    // Discord and Lark are two routes for z.ai and share the seat zai@<machine>: one at a time
    const otherRoute = ZAI_ROUTES.includes(channel) ? ZAI_ROUTES.find((c) => c !== channel && fs.existsSync(channelDir(root, c))) : null;
    if (otherRoute && (action === 'setup' || action === 'pair')) return fail(Object.assign(new Error(`z.ai already reaches Memev through ${otherRoute}; memev chat ${otherRoute} disable first`), { code: 'conflict' }), 2);
    if (channel === 'discord') {
      const dc = await import('../bridge/discord.mjs');
      if (action === 'setup') {
        const token = typeof flags.token === 'string' ? flags.token : process.env.MEMEV_DISCORD_TOKEN;
        if (!token) return fail(Object.assign(new Error('memev chat discord setup --token <bot token>'), { code: 'bad_request' }), 2);
        const r = await dc.setupDiscord(root, token);
        print({ ok: true, ...r }, `Discord bot ${r.bot_name} is set up. Next: memev chat discord pair --guild <server id> --channel <channel id> --zai <z.ai bot user id>`);
        return 0;
      }
      if (action === 'pair') {
        const ids = ['guild', 'channel', 'zai'].map((k) => flags[k]);
        const snowflake = (v) => typeof v === 'string' && /^\d{15,22}$/.test(v);
        if (!ids.every(snowflake) || (flags.person !== undefined && !snowflake(flags.person))) return fail(Object.assign(new Error('memev chat discord pair --guild <server id> --channel <channel id> --zai <z.ai bot user id> [--person <your user id>] (Discord ids are long numbers: turn on Developer Mode and use Copy ID)'), { code: 'bad_request' }), 2);
        writeState(root, 'discord', 'paired', { guild_id: flags.guild, channel_id: flags.channel, zai_user_id: flags.zai, person_user_id: snowflake(flags.person) ? flags.person : null, at: now() });
        await ensureDaemon(root, { quiet: true });
        print({ ok: true, paired: true }, 'The Discord channel is paired with zai@<this computer>.');
        return 0;
      }
    }
    if (channel === 'lark') {
      if (action === 'setup') {
        if (typeof flags['app-id'] !== 'string' || typeof flags['app-secret'] !== 'string') return fail(Object.assign(new Error('memev chat lark setup --app-id <id> --app-secret <secret>'), { code: 'bad_request' }), 2);
        const sendAs = flags['send-as'] === 'user' ? 'user' : 'bot';
        writeState(root, 'lark', 'config', { app_id: flags['app-id'], app_secret: flags['app-secret'], send_as: sendAs, read_history: !!flags['read-history'], poll_minutes: Math.max(1, Number(flags['poll-minutes']) || 10), set: now() });
        print({ ok: true, set_up: true, available: false }, 'Lark credentials are stored on this computer. The Lark connection itself is not built yet, so nothing runs.');
        return 0;
      }
      if (action === 'pair') {
        if (typeof flags.chat !== 'string' || typeof flags.zai !== 'string') return fail(Object.assign(new Error('memev chat lark pair --chat <chat_id> --zai <open_id of the z.ai bot>'), { code: 'bad_request' }), 2);
        writeState(root, 'lark', 'paired', { chat_id: flags.chat, zai_open_id: flags.zai, person_open_id: typeof flags.person === 'string' ? flags.person : null, self_open_id: typeof flags.self === 'string' ? flags.self : null, at: now() });
        print({ ok: true, paired: true }, 'The Lark chat is paired with zai@<this computer>.');
        return 0;
      }
    }
    console.error(USAGE); return 2;
  } catch (e) { return fail(e); }
}
