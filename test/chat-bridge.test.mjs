// The chat bridge end to end, with no network: a fake WhatsApp library, a fake Telegram Bot API and
// a fake Lark transport, each in the shape the code calls, on a real bus.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Bus, OPERATOR } from '../src/engine/bus.mjs';
import { Bridge, inboundBody } from '../src/bridge/core.mjs';
import { WhatsAppPlugin, socketConfig, linkWhatsApp, whatsappLinked } from '../src/bridge/whatsapp.mjs';
import { privateAuthState, authDir } from '../src/bridge/whatsapp-auth.mjs';
import { checkPin, installedProblem, BAILEYS, ADDON_DIR } from '../src/bridge/whatsapp-install.mjs';
import { TelegramPlugin, setupTelegram, startPairing } from '../src/bridge/telegram.mjs';
import { LarkPlugin, larkMention } from '../src/bridge/lark.mjs';
import { DiscordPlugin, Gateway, INTENTS, setupDiscord, discordMention } from '../src/bridge/discord.mjs';
import { supervise } from '../src/bridge/supervise.mjs';
import { channelDir, writeState, readState } from '../src/bridge/state.mjs';
import { chatStatus, disableChannel, enableWhatsApp } from '../src/cli/chat-cli.mjs';
import { qrMatrix } from '../vendor/qr.mjs';

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const HOST = { id: 'dev_host00000000', kind: 'host', label: 'hostpc', status: 'active' };
const devices = { hostId: HOST.id, get: (id) => (id === HOST.id ? HOST : null), list: () => [HOST] };
const ID = { id: 't', agent: 'claude-code', scopes: ['read', 'write'], paths: ['**'] };
const LEAD = { identity: ID, client: 'claude-code', device: HOST };
const OTHER = { identity: { ...ID, agent: 'codex' }, client: 'codex', device: HOST };

function room() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-chat-')); dirs.push(root);
  fs.mkdirSync(path.join(root, '.memev'), { recursive: true });
  const bus = new Bus({ root, devices }); bus.ensure(HOST.id);
  const lead = bus.resolve(LEAD, { need: 'write' }).seat; bus.setOperator(lead);
  bus.resolve(OTHER, { need: 'write' });
  return { root, bus, lead };
}
const toLead = (bus) => bus.unread(LEAD).messages.filter((m) => m.to === OPERATOR);
const J = (user, server) => [user, server].join('@');
const OWN = J('447700900123', 's.whatsapp.net');
const ME = { id: J('447700900123:14', 's.whatsapp.net'), lid: J('987654321012345:14', 'lid') };

// ---- a fake of the WhatsApp library, in the shape the plugin calls
function fakeBaileys() {
  const lib = {
    sockets: [], DisconnectReason: { loggedOut: 401, restartRequired: 515 },
    Browsers: { macOS: (b) => ['Mac OS', b, '14'] },
    initAuthCreds: () => ({ noiseKey: { public: 'n' }, registered: false }),
    BufferJSON: { replacer: (k, v) => v, reviver: (k, v) => v },
    proto: { Message: { AppStateSyncKeyData: { fromObject: (o) => ({ ...o, decoded: true }) } } },
    makeWASocket(config) {
      const handlers = {}; const calls = [];
      const sock = {
        config, calls, handlers,
        ev: { on: (n, fn) => { (handlers[n] ||= []).push(fn); } },
        emit: (n, v) => (handlers[n] || []).forEach((fn) => fn(v)),
        async sendMessage(jid, content) { calls.push(['sendMessage', jid, content]); return { key: { id: `SENT${calls.length}`, remoteJid: jid, fromMe: true } }; },
        end() { calls.push(['end']); }, async logout() { calls.push(['logout']); }, async requestPairingCode(n) { calls.push(['requestPairingCode', n]); return 'ABCD1234'; },
      };
      for (const name of ['groupCreate', 'groupAcceptInvite', 'groupParticipantsUpdate', 'groupLeave', 'groupMetadata', 'groupFetchAllParticipating', 'readMessages', 'sendReceipt', 'sendPresenceUpdate']) sock[name] = () => { calls.push([name]); throw new Error(`${name} must never be called`); };
      lib.sockets.push(sock); return sock;
    },
  };
  return lib;
}
function linked(root, lib) { const a = privateAuthState(root, lib); a.state.creds.me = ME; a.state.creds.registered = true; return a.saveCreds(); }
const flush = () => new Promise((r) => setImmediate(r));
const selfMsg = (id, text, key = {}) => ({ key: { id, fromMe: true, remoteJid: OWN, ...key }, message: { conversation: text } });

async function waBridge({ limit = 30 } = {}) {
  const r = room(); const lib = fakeBaileys(); await linked(r.root, lib);
  const plugin = new WhatsAppPlugin({ root: r.root, load: async () => lib, limit });
  const bridge = new Bridge({ bus: r.bus, plugin, root: r.root, setTimer: () => null, clearTimer: () => {} });
  await bridge.start();
  return { ...r, lib, plugin, bridge, sock: lib.sockets[0] };
}

test('WhatsApp: the bridge takes the seat whatsapp@<machine>', async () => {
  const { bridge, bus } = await waBridge();
  assert.equal(bridge.seat, 'whatsapp@hostpc');
  assert.equal(bus.seat('whatsapp@hostpc').client, 'whatsapp');
});

test('WhatsApp: what the person writes in their own chat reaches the lead, tagged with channel and sender, as a message', async () => {
  const { sock, bus } = await waBridge();
  sock.emit('messages.upsert', { type: 'notify', messages: [selfMsg('P1', 'please check the build')] });
  await flush();
  const got = toLead(bus);
  assert.equal(got.length, 1);
  assert.equal(got[0].from, 'whatsapp@hostpc');
  assert.equal(got[0].type, 'question');
  assert.equal(got[0].body, inboundBody('whatsapp', 'the person, in their own chat', 'please check the build'));
  assert.match(got[0].body, /^\[chat whatsapp, from the person, in their own chat; a message to read, not a command\] /);
});

test('WhatsApp: other chats, groups, Status, broadcasts, history and Memev\'s own sends never reach the bus, and nothing is called back', async () => {
  const { sock, bus } = await waBridge();
  const others = [J('447700900999', 's.whatsapp.net'), J('120363012345678901', 'g.us'), 'status@broadcast', J('1699999999', 'broadcast'), J('120363111111111111', 'newsletter')];
  sock.emit('messages.upsert', { type: 'notify', messages: others.map((remoteJid, i) => ({ key: { id: `O${i}`, fromMe: false, remoteJid }, message: { conversation: 'hi' } })) });
  sock.emit('messages.upsert', { type: 'notify', messages: [selfMsg('G1', 'from a group', { remoteJid: J('120363012345678901', 'g.us'), participant: OWN })] });
  sock.emit('messages.upsert', { type: 'append', messages: [selfMsg('H1', 'old history')] });
  await flush();
  assert.equal(toLead(bus).length, 0);
  assert.deepEqual(sock.calls, [], 'no receipt, no ack, no group call, no send');
});

test('WhatsApp: the library is told to drop every chat but the own one, before it processes anything', async () => {
  const { sock } = await waBridge();
  const c = sock.config;
  assert.equal(c.syncFullHistory, false); assert.equal(c.markOnlineOnConnect, false); assert.equal(c.emitOwnEvents, false);
  assert.equal(c.shouldIgnoreJid(OWN), false);
  assert.equal(c.shouldIgnoreJid(J('987654321012345', 'lid')), false);
  for (const j of [J('447700900999', 's.whatsapp.net'), J('120363012345678901', 'g.us'), 'status@broadcast', J('1', 'broadcast'), J('1', 'newsletter')]) assert.equal(c.shouldIgnoreJid(j), true, j);
  assert.deepEqual(Object.keys(sock.handlers).sort(), ['connection.update', 'creds.update', 'messages.upsert'], 'no group, contact, chat or history listener');
  const { plugin } = await waBridge();
  for (const name of ['groupCreate', 'groupAcceptInvite', 'groupParticipantsUpdate', 'groupLeave', 'groupMetadata', 'groupFetchAllParticipating', 'readMessages', 'sendReceipt', 'sendPresenceUpdate']) assert.equal(plugin.sock[name], undefined, `the plugin's socket has no ${name}`);
});

test('WhatsApp: the lead\'s message to the seat goes to the person\'s own chat, and only that', async () => {
  const { sock, bus, bridge } = await waBridge();
  bus.send(LEAD, { to: 'whatsapp@hostpc', type: 'answer', body: 'the build is green' });
  bus.send(LEAD, { to: 'all', type: 'status', body: 'to everyone: stays on the bus' });
  bus.send(OTHER, { to: 'whatsapp@hostpc', type: 'status', body: 'not the lead: stays on the bus' });
  assert.equal(await bridge.poll(), 1);
  assert.deepEqual(sock.calls, [['sendMessage', OWN, { text: 'the build is green' }]]);
});

test('WhatsApp: Memev\'s own message coming back is dropped, so it cannot loop', async () => {
  const { sock, bus, bridge } = await waBridge();
  bus.send(LEAD, { to: 'whatsapp@hostpc', type: 'answer', body: 'hello' });
  await bridge.poll();
  const sentId = 'SENT1';
  sock.emit('messages.upsert', { type: 'notify', messages: [selfMsg(sentId, 'hello')] });
  await flush();
  assert.equal(toLead(bus).length, 0);
  assert.equal(await bridge.poll(), 0, 'its own post is not sent back either');
  assert.equal(bridge.forPhone({ from: 'whatsapp@hostpc', to: 'whatsapp@hostpc', operator: true, body: 'x' }), false, 'its own post, even addressed to itself as if by the lead');
});

test('WhatsApp: the hourly limit stops sends, the lead is told once, and nothing is retried', async () => {
  const { sock, bus, bridge, root } = await waBridge({ limit: 2 });
  for (let i = 0; i < 4; i++) bus.send(LEAD, { to: 'whatsapp@hostpc', type: 'answer', body: `n${i}` });
  assert.equal(await bridge.poll(), 2);
  assert.equal(sock.calls.filter((c) => c[0] === 'sendMessage').length, 2);
  const notes = bus.unread(LEAD).messages.filter((m) => m.from === 'whatsapp@hostpc' && m.type === 'status');
  assert.equal(notes.length, 1); assert.match(notes[0].body, /hourly message limit/);
  assert.equal(readState(root, 'whatsapp', 'status').last_refusal.code, 'rate_limited');
  assert.equal(await bridge.poll(), 0, 'the refused ones are not sent later');
});

test('WhatsApp: a message that looks like a credential is not passed on, and the person is told why', async () => {
  const { sock, bus } = await waBridge();
  sock.emit('messages.upsert', { type: 'notify', messages: [selfMsg('P2', 'my key is AKIAABCDEFGHIJKLMNOP')] });
  await flush(); await flush();
  assert.equal(toLead(bus).length, 0);
  assert.equal(sock.calls[0][1], OWN); assert.match(sock.calls[0][2].text, /password or key/);
});

test('WhatsApp: the auth state is 0600 files in a 0700 folder, under the vault\'s private machine-local state', async () => {
  const { root } = await waBridge();
  const dir = authDir(root);
  assert.ok(dir.startsWith(path.join(root, '.memev', 'chat', 'whatsapp')));
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(root, '.memev', 'chat')).mode & 0o777, 0o700);
    const files = fs.readdirSync(dir); assert.ok(files.includes('creds.json'));
    const a = privateAuthState(root, fakeBaileys()); await a.state.keys.set({ 'pre-key': { 1: { k: 1 } }, 'app-state-sync-key': { A: { x: 1 } } });
    for (const f of fs.readdirSync(dir)) assert.equal(fs.statSync(path.join(dir, f)).mode & 0o777, 0o600, f);
    assert.deepEqual(await a.state.keys.get('app-state-sync-key', ['A']), { A: { x: 1, decoded: true } });
    await a.state.keys.set({ 'pre-key': { 1: null } }); assert.ok(!fs.existsSync(path.join(dir, 'pre-key-1.json')));
  }
});

test('WhatsApp: logged out on the phone removes the auth state here', async () => {
  const { sock, root } = await waBridge();
  sock.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
  assert.ok(!fs.existsSync(authDir(root))); assert.equal(whatsappLinked(root), false);
});

test('WhatsApp link: each QR is handed out as data; the linking socket acts on nothing', async () => {
  const r = room(); const lib = fakeBaileys(); const codes = [];
  const p = linkWhatsApp(r.root, { load: async () => lib, onCode: (c) => codes.push(c) });
  await flush();
  const s1 = lib.sockets[0];
  assert.equal(s1.config.shouldIgnoreJid(OWN), true, 'while linking, every chat is ignored');
  s1.emit('connection.update', { qr: 'https://wa.me/settings/linked_devices#2@ref,a,b,c,1' });
  // the scan: credentials arrive, the server asks for a restart, the second socket opens
  const a = privateAuthState(r.root, lib); a.state.creds.me = ME; await a.saveCreds();
  s1.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 515 } } } });
  await flush(); await flush();
  lib.sockets[1].emit('connection.update', { connection: 'open' });
  assert.deepEqual(await p, { linked: true });
  assert.deepEqual(codes, [{ qr: 'https://wa.me/settings/linked_devices#2@ref,a,b,c,1' }]);
  assert.ok(lib.sockets.every((s) => s.calls.every((c) => c[0] === 'end')));
});

test('WhatsApp: turning it on needs the warning accepted; turning it off removes every file it kept', async () => {
  const r = room();
  await assert.rejects(enableWhatsApp(r.root, {}), (e) => e.code === 'needs_accept' && /unofficial WhatsApp connection\. WhatsApp's terms do not allow it, and WhatsApp could suspend this number\. Memev only messages you, in your own chat\./.test(e.message));
  assert.ok(!fs.existsSync(channelDir(r.root, 'whatsapp')));
  let installed = 0;
  const on = await enableWhatsApp(r.root, { accept: true, limit: 10, install: async () => { installed++; return { version: BAILEYS.version }; } });
  assert.deepEqual([on.enabled, on.limit, installed], [true, 10, 1]);
  await linked(r.root, fakeBaileys());
  assert.ok(whatsappLinked(r.root));
  assert.deepEqual(disableChannel(r.root, 'whatsapp'), { channel: 'whatsapp', removed: true });
  assert.ok(!fs.existsSync(channelDir(r.root, 'whatsapp')));
  assert.equal(whatsappLinked(r.root), false);
});

test('WhatsApp: after disable, a late key or credential update from the closing socket writes nothing back', async () => {
  const { root, sock } = await waBridge();
  const a = privateAuthState(root, fakeBaileys());
  disableChannel(root, 'whatsapp');
  await a.state.keys.set({ 'pre-key': { 9: { k: 1 } } }); await a.saveCreds();
  sock.emit('creds.update', {}); await flush();
  assert.ok(!fs.existsSync(channelDir(root, 'whatsapp')), 'the state stays removed');
});

test('WhatsApp library pin: the shipped manifest and lockfile pin one exact version with its integrity, every package from the registry', () => {
  assert.deepEqual(checkPin(), []);
  const lock = JSON.parse(fs.readFileSync(path.join(ADDON_DIR, 'pinned-lock.json'), 'utf8'));
  assert.equal(lock.packages[`node_modules/${BAILEYS.name}`].integrity, BAILEYS.integrity);
  assert.equal(BAILEYS.license, 'MIT');
  assert.match(installedProblem(room().root), /not installed/);
  const pkg = JSON.parse(fs.readFileSync(path.join(ADDON_DIR, '..', '..', 'package.json'), 'utf8'));
  assert.ok(!pkg.dependencies, 'Memev itself still has no runtime dependencies');
});

// ---- a fake Telegram Bot API, in the shape fetchTransport has
function fakeTelegram() {
  const calls = []; const queue = [];
  return {
    calls, queue,
    async call(method, params = {}) {
      calls.push([method, params]);
      if (method === 'getMe') return { id: 4242, is_bot: true, username: 'my_memev_bot' };
      if (method === 'sendMessage') return { message_id: 900 + calls.length, chat: { id: params.chat_id } };
      if (method === 'getUpdates') return queue.splice(0);
      throw new Error(`unexpected ${method}`);
    },
  };
}
const TOKEN = `123456789:${'A'.repeat(35)}`;
const upd = (id, text, from = 5550001, chat = { id: from, type: 'private' }) => ({ update_id: id, message: { message_id: id, text, chat, from: { id: from, is_bot: false } } });
async function tgSetup(clock = Date.now) {
  const r = room(); const t = fakeTelegram();
  assert.deepEqual(await setupTelegram(r.root, TOKEN, { transport: t }), { bot_username: 'my_memev_bot' });
  const plugin = new TelegramPlugin({ root: r.root, transport: t, clock });
  const bridge = new Bridge({ bus: r.bus, plugin: { channel: 'telegram', start: async () => {}, stop: async () => {}, send: (x) => plugin.send(x), set onInbound(f) { plugin.onInbound = f; } }, root: r.root, setTimer: () => null });
  await bridge.start();
  return { ...r, t, plugin, bridge };
}
const sends = (t) => t.calls.filter((c) => c[0] === 'sendMessage');

test('Telegram: the token is checked and stored 0600; pairing is a one-time t.me link', async () => {
  const { root, t } = await tgSetup();
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(channelDir(root, 'telegram'), 'config.json')).mode & 0o777, 0o600);
  const p = startPairing(root);
  assert.match(p.link, /^https:\/\/t\.me\/my_memev_bot\?start=[A-Za-z0-9_-]{16}$/);
  assert.ok(!fs.readFileSync(path.join(channelDir(root, 'telegram'), 'pairing.json'), 'utf8').includes(p.code), 'only the hash is stored');
  await assert.rejects(setupTelegram(root, 'not a token', { transport: t }), { code: 'bad_request' });
});

test('Telegram: a wrong code, a code in a group and an expired code pair nobody, and get no reply', async () => {
  let at = Date.parse('2026-11-07T10:00:00Z');
  const { root, t, plugin } = await tgSetup(() => at);
  const p = startPairing(root, { clock: () => at });
  await plugin.inbound(upd(1, '/start wrongcode'));
  await plugin.inbound(upd(2, `/start ${p.code}`, 5550001, { id: -100777, type: 'group' }));
  await plugin.inbound(upd(4, `/start ${p.code}`, 5550001, { id: 5550009, type: 'private' })); // a chat that is not the sender's own
  at += 11 * 60e3;
  await plugin.inbound(upd(3, `/start ${p.code}`));
  assert.equal(readState(root, 'telegram', 'paired'), null);
  assert.deepEqual(sends(t), []);
});

test('Telegram: the right code pairs that person once; anyone else after that is ignored with no reply', async () => {
  const { root, t, plugin, bus } = await tgSetup();
  const p = startPairing(root);
  assert.deepEqual(await plugin.inbound(upd(1, `/start ${p.code}`)), { paired: true });
  assert.deepEqual(readState(root, 'telegram', 'paired').chat_id, 5550001);
  assert.equal(readState(root, 'telegram', 'pairing'), null, 'the code is used up');
  assert.equal(sends(t).length, 1); assert.equal(sends(t)[0][1].chat_id, 5550001);
  await plugin.inbound(upd(2, `/start ${p.code}`, 5550002));
  await plugin.inbound(upd(3, 'hello from a stranger', 5550002));
  await plugin.inbound(upd(4, 'hello from a group', 5550001, { id: -100777, type: 'supergroup' }));
  assert.equal(sends(t).length, 1, 'no reply to anyone else');
  assert.equal(toLead(bus).length, 0);
  await plugin.inbound(upd(5, 'it is me'));
  const got = toLead(bus);
  assert.equal(got.length, 1); assert.equal(got[0].from, 'telegram@hostpc');
  assert.equal(got[0].body, inboundBody('telegram', 'the person', 'it is me'));
});

test('Telegram: the lead\'s message goes to the paired chat only, under the hourly limit', async () => {
  const { root, t, plugin, bus, bridge } = await tgSetup();
  await plugin.inbound(upd(1, `/start ${startPairing(root).code}`));
  bus.send(LEAD, { to: 'telegram@hostpc', type: 'answer', body: 'done' });
  assert.equal(await bridge.poll(), 1);
  assert.deepEqual(sends(t).at(-1)[1], { chat_id: 5550001, text: 'done' });
  await assert.rejects(plugin.sendTo(5550002, 'x'), { code: 'refused_other_chat' });
  await assert.rejects(plugin.sendTo(-100777, 'x'), { code: 'refused_other_chat' });
});

test('Telegram: long polling asks for messages only and moves the offset on', async () => {
  const { t, plugin } = await tgSetup();
  t.queue.push(upd(10, 'x', 5550002), upd(11, 'y', 5550002));
  assert.equal(await plugin.pollOnce(), 2);
  const gu = t.calls.find((c) => c[0] === 'getUpdates')[1];
  assert.deepEqual(gu.allowed_updates, ['message']);
  await plugin.pollOnce();
  assert.equal(t.calls.filter((c) => c[0] === 'getUpdates').at(-1)[1].offset, 12);
});

// ---- a fake Lark transport, in the interface lark.mjs defines
test('Lark: one chat to zai@<machine>; the z.ai bot and the person reach the lead, the lead\'s answer mentions the z.ai bot in that chat only', async () => {
  const r = room(); const sent = []; let deliver = null;
  writeState(r.root, 'lark', 'config', { app_id: 'cli_x', app_secret: 's' });
  writeState(r.root, 'lark', 'paired', { chat_id: 'oc_paired', zai_open_id: 'ou_zai', person_open_id: 'ou_me', self_open_id: 'ou_self' });
  const plugin = new LarkPlugin({ root: r.root, createTransport: () => ({ start: async (fn) => { deliver = fn; }, stop: async () => {}, sendText: async (chat, text) => { sent.push([chat, text]); return `om_sent${sent.length}`; } }) });
  const bridge = new Bridge({ bus: r.bus, plugin, root: r.root, setTimer: () => null });
  assert.equal(await bridge.start(), 'zai@hostpc');
  const ev = (open_id, chat_id = 'oc_paired', id = 'om_1') => ({ sender: { sender_id: { open_id }, sender_type: 'user' }, message: { message_id: id, chat_id, chat_type: 'group', message_type: 'text', content: JSON.stringify({ text: `from ${open_id}` }) } });
  await deliver(ev('ou_zai')); await deliver(ev('ou_me', 'oc_paired', 'om_2'));
  await deliver(ev('ou_stranger', 'oc_paired', 'om_3')); await deliver(ev('ou_zai', 'oc_other', 'om_4')); await deliver(ev('ou_self', 'oc_paired', 'om_5'));
  await flush();
  assert.deepEqual(toLead(r.bus).map((m) => m.body), [inboundBody('lark', 'the z.ai bot', 'from ou_zai'), inboundBody('lark', 'the person', 'from ou_me')]);
  r.bus.send(LEAD, { to: 'zai@hostpc', type: 'task', body: 'summarise the plan' });
  assert.equal(await bridge.poll(), 1);
  assert.deepEqual(sent, [['oc_paired', `${larkMention('ou_zai')} summarise the plan`]]);
  await deliver(ev('ou_zai', 'oc_paired', 'om_sent1')); await flush();
  assert.equal(toLead(r.bus).length, 0, 'its own message id is dropped');
  await assert.rejects(plugin.sendTo('oc_other', 'x'), { code: 'refused_other_chat' });
});

test('Lark: when bot replies are read from history, polling waits its interval, counts the month, dedupes and stops at the quota error', async () => {
  const r = room(); const sent = []; let t = Date.parse('2026-11-07T10:00:00Z'); let calls = 0; let fail = null;
  writeState(r.root, 'lark', 'config', { app_id: 'cli_x', app_secret: 's', read_history: true, poll_minutes: 10, send_as: 'user' });
  writeState(r.root, 'lark', 'paired', { chat_id: 'oc_paired', zai_open_id: 'ou_zai', person_open_id: 'ou_me', self_open_id: 'ou_self' });
  const item = (id, open_id, text) => ({ message_id: id, sender: { id: open_id, sender_type: 'app' }, msg_type: 'text', body: { content: JSON.stringify({ text }) }, create_time: String(t) });
  const transport = { start: async () => {}, stop: async () => {}, sendText: async (c, x, o) => { sent.push([c, x, o]); return 'om_s'; }, listMessages: async () => { calls++; if (fail) throw fail; return [item('om_a', 'ou_zai', 'reply one'), item('om_a', 'ou_zai', 'reply one'), item('om_b', 'ou_stranger', 'no')]; } };
  const plugin = new LarkPlugin({ root: r.root, createTransport: () => transport, clock: () => t, setTimer: () => null });
  const bridge = new Bridge({ bus: r.bus, plugin, root: r.root, setTimer: () => null });
  await bridge.start();
  assert.equal(await plugin.pollHistory(), 1, 'one message passed on: the duplicate and the stranger are not');
  assert.equal(await plugin.pollHistory(), null, 'not again inside the interval'); assert.equal(calls, 1);
  t += 10 * 60e3; assert.equal(await plugin.pollHistory(), 0, 'the same message from history is not passed on twice');
  assert.equal(plugin.quota().calls, 2);
  t += 10 * 60e3; fail = Object.assign(new Error('quota'), { code: 99991403 });
  assert.equal(await plugin.pollHistory(), null);
  t += 10 * 60e3; assert.equal(await plugin.pollHistory(), null, 'paused for the month'); assert.equal(calls, 3);
  assert.match(readState(r.root, 'lark', 'status').history.paused, /99991403/);
  assert.deepEqual(toLead(r.bus).map((m) => m.body), [inboundBody('lark', 'the z.ai bot', 'reply one')]);
  r.bus.send(LEAD, { to: 'zai@hostpc', type: 'task', body: 'go' }); await bridge.poll();
  assert.deepEqual(sent[0][2], { as: 'user' }, 'the sending identity is the configured one');
});

// ---- a fake Discord gateway (a WebSocket in the shape the Gateway uses) and a fake REST transport
function fakeWS() {
  const opened = [];
  class WS { constructor(url) { this.url = url; this.sent = []; this.closed = null; opened.push(this); } send(x) { this.sent.push(JSON.parse(x)); } close(code) { this.closed = code; this.onclose?.({ code }); } recv(p) { this.onmessage({ data: JSON.stringify(p) }); } }
  return { WS, opened };
}
const DISCORD_TOKEN = `${'M'.repeat(24)}.${'G'.repeat(6)}.${'x'.repeat(38)}`;
const DIDS = { guild_id: '111111111111111111', channel_id: '222222222222222222', zai_user_id: '333333333333333333', person_user_id: '444444444444444444' };
test('Discord gateway: identifies with server messages and message content only, keeps a heartbeat, resumes, and stops on a fatal close', () => {
  const { WS, opened } = fakeWS(); const got = []; const timers = [];
  const g = new Gateway({ token: DISCORD_TOKEN, onMessage: (m) => got.push(m), WebSocketImpl: WS, setTimer: (fn, ms) => { timers.push([fn, ms]); return timers.length; }, clearTimer: () => {} });
  g.start();
  const ws = opened[0]; assert.match(ws.url, /^wss:\/\/gateway\.discord\.gg\/\?v=10&encoding=json$/);
  ws.recv({ op: 10, d: { heartbeat_interval: 41250 } });
  assert.deepEqual(ws.sent[0], { op: 2, d: { token: DISCORD_TOKEN, intents: INTENTS, properties: { os: process.platform, browser: 'memev', device: 'memev' } } });
  assert.equal(INTENTS, 512 | 32768, 'GUILD_MESSAGES and MESSAGE_CONTENT, not DIRECT_MESSAGES (4096)');
  ws.recv({ op: 0, s: 1, t: 'READY', d: { session_id: 'sess', resume_gateway_url: 'wss://resume.example', user: { id: '555555555555555555' } } });
  ws.recv({ op: 0, s: 2, t: 'MESSAGE_CREATE', d: { id: 'm1' } });
  ws.recv({ op: 0, s: 3, t: 'GUILD_CREATE', d: {} });
  assert.deepEqual(got, [{ id: 'm1' }]);
  timers[0][0](); assert.deepEqual(ws.sent.at(-1), { op: 1, d: 3 }, 'heartbeat with the last sequence');
  ws.recv({ op: 7 }); timers.at(-1)[0]();
  const ws2 = opened[1]; assert.equal(ws2.url, 'wss://resume.example?v=10&encoding=json');
  ws2.recv({ op: 10, d: { heartbeat_interval: 41250 } });
  assert.deepEqual(ws2.sent[0], { op: 6, d: { token: DISCORD_TOKEN, session_id: 'sess', seq: 3 } });
  ws2.close(4014); assert.equal(opened.length, 2); assert.equal(g.stopped, true, 'a privileged intent not enabled: no reconnect loop');
});

test('Discord: one private channel to zai@<machine>; the z.ai bot and the person reach the lead; the answer mentions only the z.ai bot, in that channel only', async () => {
  const r = room(); const posts = []; let deliver = null;
  const rest = { me: async () => ({ id: '555555555555555555', bot: true, username: 'memev-bot' }), createMessage: async (c, body) => { posts.push([c, body]); return `90000000000000000${posts.length}`; } };
  assert.deepEqual(await setupDiscord(r.root, DISCORD_TOKEN, { rest }), { bot_user_id: '555555555555555555', bot_name: 'memev-bot' });
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(channelDir(r.root, 'discord'), 'config.json')).mode & 0o777, 0o600);
  writeState(r.root, 'discord', 'paired', DIDS);
  const plugin = new DiscordPlugin({ root: r.root, rest, makeGateway: (o) => { deliver = o.onMessage; return { start() {}, stop() {}, selfId: null }; } });
  const bridge = new Bridge({ bus: r.bus, plugin, root: r.root, setTimer: () => null });
  assert.equal(await bridge.start(), 'zai@hostpc');
  const msg = (author, over = {}) => ({ id: `m${Math.random()}`, guild_id: DIDS.guild_id, channel_id: DIDS.channel_id, author: { id: author }, content: `from ${author}`, ...over });
  deliver(msg(DIDS.zai_user_id)); deliver(msg(DIDS.person_user_id));
  deliver(msg(DIDS.zai_user_id, { guild_id: undefined })); deliver(msg(DIDS.zai_user_id, { channel_id: '999999999999999999' }));
  deliver(msg('555555555555555555')); deliver(msg('666666666666666666'));
  await flush();
  assert.deepEqual(toLead(r.bus).map((m) => m.body), [inboundBody('discord', 'the z.ai bot', `from ${DIDS.zai_user_id}`), inboundBody('discord', 'the person', `from ${DIDS.person_user_id}`)]);
  r.bus.send(LEAD, { to: 'zai@hostpc', type: 'task', body: 'summarise the plan @everyone' });
  assert.equal(await bridge.poll(), 1);
  assert.deepEqual(posts, [[DIDS.channel_id, { content: `${discordMention(DIDS.zai_user_id)} summarise the plan @everyone`, allowed_mentions: { users: [DIDS.zai_user_id] } }]]);
  deliver(msg(DIDS.zai_user_id, { id: '900000000000000001' })); await flush();
  assert.equal(toLead(r.bus).length, 0, 'its own message id is dropped');
  await assert.rejects(plugin.sendTo('999999999999999999', 'x'), { code: 'refused_other_chat' });
});

test('the daemon hosts what is turned on, and stops it when it is turned off', async () => {
  const r = room(); const made = [];
  const make = async (ch) => { const p = { channel: ch, stopped: null, start: async () => {}, stop: async (o) => { p.stopped = o; }, send: async () => null }; made.push(p); return p; };
  const sup = supervise({ bus: r.bus }, { root: r.root, make, intervalMs: 3600e3, log: () => {} });
  await sup.tick(); assert.equal(sup.running.size, 0, 'everything is off by default');
  writeState(r.root, 'telegram', 'config', { token: TOKEN, bot_username: 'b' });
  writeState(r.root, 'whatsapp', 'enabled', { accepted_warning: 'x' }); // enabled, but the library is not installed: not started
  await sup.tick();
  assert.deepEqual([...sup.running.keys()], ['telegram']);
  assert.equal(sup.running.get('telegram').seat, 'telegram@hostpc');
  disableChannel(r.root, 'telegram');
  await sup.tick();
  assert.equal(sup.running.size, 0); assert.deepEqual(made[0].stopped, { logout: true });
  const s = await chatStatus(r.root);
  assert.deepEqual(s.channels.map((c) => [c.channel, c.on]), [['whatsapp', true], ['telegram', false], ['discord', false], ['lark', false]]);
  assert.equal(s.channels[0].installed, false);
  await sup.stop();
});

test('QR codes up to version 13 match a reference encoder, so a WhatsApp link code fits', () => {
  const bits = (m) => crypto.createHash('sha256').update(m.flat().map((b) => (b ? '1' : '0')).join('')).digest('hex');
  const text = (n) => (`https://wa.me/settings/linked_devices#2@${'Ab9+/='.repeat(80)}`).slice(0, n);
  // the hashes came from an independent QR encoder at error correction L, mask 0, same version
  assert.equal(qrMatrix(text(257)).length, 61);
  assert.equal(bits(qrMatrix(text(257))), '0320e8f06cd73526683bfb7474b4f7a0877112d0d1efb76e1057b104438a5ca1');
  assert.equal(qrMatrix(text(400)).length, 69);
  assert.equal(bits(qrMatrix(text(400))), 'f84ee306178e301320a353472e582ee0fdfbda978162d00056ccfb63b1b63f3b');
  assert.throws(() => qrMatrix(text(430)), /too long/);
});
