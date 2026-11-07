// The chat bridge's hard guards, each on its own: Memev only messages the person, and only the
// person (or, for Lark, the paired chat) reaches the lead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyJid, whatsappSelf, isSelfChat, checkWhatsAppDestination, acceptWhatsAppInbound, narrowSocket, WHATSAPP_EVENTS,
  checkTelegramDestination, acceptTelegramUpdate, telegramStartCode, checkLarkDestination, acceptLarkEvent,
  RateLimiter, guardedSender, newPairingCode, pairingMatches, ChatGuardError,
} from '../src/bridge/guards.mjs';

// A WhatsApp address (JID) is user@server; built from its parts here, since it is not an e-mail address
const PN = 's.whatsapp.net', GROUP = 'g.us', BCAST = 'broadcast', NEWS = 'newsletter', LID = 'lid';
const J = (user, server) => [user, server].join('@');
const CREDS = { me: { id: J('447700900123:14', PN), lid: J('987654321012345:14', LID), name: 'Me' } };
const SELF = whatsappSelf(CREDS);
const refused = (fn, code) => assert.throws(fn, (e) => e instanceof ChatGuardError && (code ? e.code === code : true));

test('the own account is the user part of creds.me, without the device part', () => {
  assert.deepEqual(SELF, { pnUser: '447700900123', lidUser: '987654321012345', jid: J('447700900123', PN) });
  assert.equal(whatsappSelf({}), null);
  assert.equal(whatsappSelf({ me: { id: J('1203630', GROUP) } }), null, 'a group is never the own account');
});

test('outbound WhatsApp: the own chat is the one destination', () => {
  assert.equal(checkWhatsAppDestination(J('447700900123', PN), SELF), J('447700900123', PN));
});
test('outbound WhatsApp: another person is refused', () => refused(() => checkWhatsAppDestination(J('447700900999', PN), SELF), 'refused_other_user'));
test('outbound WhatsApp: a group is refused', () => refused(() => checkWhatsAppDestination(J('120363012345678901', GROUP), SELF), 'refused_group'));
test('outbound WhatsApp: a broadcast list is refused', () => refused(() => checkWhatsAppDestination(J('1699999999', BCAST), SELF), 'refused_broadcast'));
test('outbound WhatsApp: Status is refused', () => refused(() => checkWhatsAppDestination('status@broadcast', SELF), 'refused_status'));
test('outbound WhatsApp: a channel (newsletter) is refused', () => refused(() => checkWhatsAppDestination(J('120363111111111111', NEWS), SELF), 'refused_newsletter'));
test('outbound WhatsApp: the own number with a device part, the hidden id, junk and no link are refused', () => {
  refused(() => checkWhatsAppDestination(J('447700900123:14', PN), SELF), 'refused_other_user');
  refused(() => checkWhatsAppDestination(J('987654321012345', LID), SELF), 'refused_lid');
  refused(() => checkWhatsAppDestination('447700900123', SELF), 'refused_other');
  refused(() => checkWhatsAppDestination(undefined, SELF), 'refused_other');
  refused(() => checkWhatsAppDestination(J('447700900123', PN), null), 'not_linked');
});

test('address kinds', () => {
  assert.equal(classifyJid('status@broadcast'), 'status');
  assert.equal(classifyJid(J('1', BCAST)), 'broadcast');
  assert.equal(classifyJid(J('1', GROUP)), 'group');
  assert.equal(classifyJid(J('1', NEWS)), 'newsletter');
  assert.equal(classifyJid(J('1', LID)), 'lid');
  assert.equal(classifyJid(J('1', PN)), 'user');
  assert.ok(isSelfChat(J('987654321012345', LID), SELF) && isSelfChat(J('447700900123', PN), SELF));
  assert.ok(!isSelfChat(J('447700900999', PN), SELF) && !isSelfChat(J('447700900123', GROUP), SELF));
});

const wa = (key, text = 'hello') => ({ key: { id: 'ABC1', fromMe: true, remoteJid: J('447700900123', PN), ...key }, message: { conversation: text } });
test('inbound WhatsApp: the person writing in the own chat is accepted, by number or hidden id', () => {
  assert.deepEqual(acceptWhatsAppInbound(wa({}), SELF, new Set()), { id: 'ABC1', text: 'hello' });
  assert.ok(acceptWhatsAppInbound(wa({ remoteJid: J('987654321012345', LID), remoteJidAlt: J('447700900123', PN) }), SELF, new Set()));
  assert.ok(acceptWhatsAppInbound({ key: wa({}).key, message: { extendedTextMessage: { text: 'with a link' } } }, SELF, new Set()));
});
test('inbound WhatsApp: another chat, a group, Status, a broadcast and a channel are ignored', () => {
  for (const remoteJid of [J('447700900999', PN), J('120363012345678901', GROUP), 'status@broadcast', J('1699999999', BCAST), J('120363111111111111', NEWS)]) {
    assert.equal(acceptWhatsAppInbound(wa({ remoteJid }), SELF, new Set()), null, remoteJid);
    assert.equal(acceptWhatsAppInbound(wa({ remoteJid, fromMe: false }), SELF, new Set()), null, remoteJid);
  }
  assert.equal(acceptWhatsAppInbound(wa({ participant: J('447700900999', PN) }), SELF, new Set()), null, 'a participant means a group');
  assert.equal(acceptWhatsAppInbound(wa({ remoteJidAlt: J('447700900999', PN) }), SELF, new Set()), null, 'both forms must be the own chat');
});
test('inbound WhatsApp: a message not written by the account is ignored', () => {
  assert.equal(acceptWhatsAppInbound(wa({ fromMe: false }), SELF, new Set()), null);
});
test('inbound WhatsApp: Memev\'s own message is dropped, so it cannot loop', () => {
  assert.equal(acceptWhatsAppInbound(wa({}), SELF, new Set(['ABC1'])), null);
});
test('inbound WhatsApp: no text (media, an invite) is nothing to pass on', () => {
  assert.equal(acceptWhatsAppInbound({ key: wa({}).key, message: { groupInviteMessage: { groupJid: J('1', GROUP) } } }, SELF, new Set()), null);
  assert.equal(acceptWhatsAppInbound(wa({}, '   '), SELF, new Set()), null);
});

test('groups: the socket the bridge holds has no group call, no receipts, no presence and no fetch', () => {
  const calls = [];
  const raw = { ev: { on: (n) => calls.push(n) }, sendMessage() {}, end() {}, logout() {}, requestPairingCode() {} };
  for (const name of ['groupCreate', 'groupAcceptInvite', 'groupAcceptInviteV4', 'groupParticipantsUpdate', 'groupLeave', 'groupMetadata', 'groupFetchAllParticipating', 'groupInviteCode', 'groupGetInviteInfo', 'readMessages', 'sendReceipt', 'sendReceipts', 'sendPresenceUpdate', 'presenceSubscribe', 'fetchStatus', 'onWhatsApp', 'newsletterFollow', 'chatModify']) raw[name] = () => { throw new Error(`${name} reached the library`); };
  const s = narrowSocket(raw);
  assert.deepEqual(Object.keys(s).sort(), ['end', 'ev', 'logout', 'requestPairingCode', 'sendMessage']);
  for (const name of ['groupCreate', 'groupAcceptInvite', 'groupParticipantsUpdate', 'groupLeave', 'groupMetadata', 'readMessages', 'sendPresenceUpdate']) assert.equal(s[name], undefined, name);
  for (const ev of ['groups.upsert', 'groups.update', 'group-participants.update', 'contacts.upsert', 'chats.upsert', 'messaging-history.set', 'presence.update']) refused(() => s.ev.on(ev, () => {}), 'refused_event');
  for (const ev of WHATSAPP_EVENTS) s.ev.on(ev, () => {});
  assert.deepEqual(calls, WHATSAPP_EVENTS);
});

const PAIRED = { user_id: 5550001, chat_id: 5550001 };
const tg = (m) => ({ update_id: 1, message: { message_id: 7, text: 'hi', chat: { id: 5550001, type: 'private' }, from: { id: 5550001, is_bot: false }, ...m } });
test('outbound Telegram: only the paired chat', () => {
  assert.equal(checkTelegramDestination(5550001, PAIRED), 5550001);
  refused(() => checkTelegramDestination(5550002, PAIRED), 'refused_other_chat');
  refused(() => checkTelegramDestination(-1001234567890, PAIRED), 'refused_other_chat');
  refused(() => checkTelegramDestination(5550001, null), 'not_paired');
  refused(() => checkTelegramDestination(-100, { user_id: 1, chat_id: -100 }), 'not_paired');
});
test('inbound Telegram: the paired person is accepted; others, groups, channels and bots are ignored', () => {
  assert.deepEqual(acceptTelegramUpdate(tg({}), PAIRED), { id: 7, text: 'hi' });
  assert.equal(acceptTelegramUpdate(tg({ from: { id: 5550002, is_bot: false }, chat: { id: 5550002, type: 'private' } }), PAIRED), null, 'unpaired sender');
  assert.equal(acceptTelegramUpdate(tg({ chat: { id: -100123, type: 'group' } }), PAIRED), null, 'group');
  assert.equal(acceptTelegramUpdate(tg({ chat: { id: -100123, type: 'supergroup' } }), PAIRED), null, 'supergroup');
  assert.equal(acceptTelegramUpdate(tg({ chat: { id: 5550001, type: 'group' } }), PAIRED), null, 'a group is dropped on its type alone');
  assert.equal(acceptTelegramUpdate({ update_id: 2, channel_post: { chat: { id: -100, type: 'channel' }, text: 'x' } }, PAIRED), null, 'channel');
  assert.equal(acceptTelegramUpdate(tg({ from: { id: 5550001, is_bot: true } }), PAIRED), null, 'a bot');
  assert.equal(acceptTelegramUpdate(tg({}), null), null, 'not paired');
});
test('Telegram /start code: only in a private chat from a person', () => {
  assert.deepEqual(telegramStartCode(tg({ text: '/start abc_DEF-1' })), { code: 'abc_DEF-1', user_id: 5550001, chat_id: 5550001 });
  assert.equal(telegramStartCode(tg({ text: '/start abc', chat: { id: -5, type: 'group' } })), null);
  assert.equal(telegramStartCode(tg({ text: 'hello' })), null);
});

const LP = { chat_id: 'oc_paired', zai_open_id: 'ou_zai', person_open_id: 'ou_me', self_open_id: 'ou_self' };
const lark = (over = {}) => ({ sender: { sender_id: { open_id: 'ou_zai' }, sender_type: 'app' }, message: { message_id: 'om_1', chat_id: 'oc_paired', chat_type: 'group', message_type: 'text', content: JSON.stringify({ text: 'answer' }) }, ...over });
test('outbound Lark: only the paired chat', () => {
  assert.equal(checkLarkDestination('oc_paired', LP), 'oc_paired');
  refused(() => checkLarkDestination('oc_other', LP), 'refused_other_chat');
  refused(() => checkLarkDestination('oc_paired', null), 'not_paired');
});
test('inbound Lark: the z.ai bot and the person in the paired chat; any other chat, sender or own message is ignored', () => {
  assert.deepEqual(acceptLarkEvent(lark(), LP, new Set()), { id: 'om_1', text: 'answer', by: 'zai' });
  assert.equal(acceptLarkEvent(lark({ sender: { sender_id: { open_id: 'ou_me' }, sender_type: 'user' } }), LP, new Set()).by, 'person');
  assert.equal(acceptLarkEvent(lark({ message: { ...lark().message, chat_id: 'oc_other' } }), LP, new Set()), null, 'other chat');
  assert.equal(acceptLarkEvent(lark({ sender: { sender_id: { open_id: 'ou_stranger' }, sender_type: 'user' } }), LP, new Set()), null, 'stranger');
  assert.equal(acceptLarkEvent(lark({ sender: { sender_id: { open_id: 'ou_self' }, sender_type: 'app' } }), LP, new Set()), null, 'own bot');
  assert.equal(acceptLarkEvent(lark({ sender: { sender_id: { open_id: 'ou_self' }, sender_type: 'app' } }), { ...LP, zai_open_id: 'ou_self' }, new Set()), null, 'own bot, even when set as the z.ai bot by mistake');
  assert.equal(acceptLarkEvent(lark(), LP, new Set(['om_1'])), null, 'own message id');
});

test('rate limit: at most N an hour, then refused, and free again after the hour', () => {
  let t = 0; const r = new RateLimiter({ max: 3, now: () => t });
  r.take(); r.take(); r.take();
  refused(() => r.take(), 'rate_limited');
  t = 3600e3 - 1; refused(() => r.take(), 'rate_limited');
  t = 3600e3; r.take();
  assert.equal(new RateLimiter().max, 30, 'the default is 30');
});

test('guardedSender: a refusal is logged and raised, the transport never runs, and nothing is retried', async () => {
  const sent = []; const refusals = [];
  const send = guardedSender({ check: (d) => { if (d !== 'me') throw new ChatGuardError('refused_other_user', 'no'); }, limiter: new RateLimiter({ max: 2 }), transport: async (d, t) => { sent.push([d, t]); return `id${sent.length}`; }, onRefuse: (e) => refusals.push(e.code) });
  await assert.rejects(send('someone', 'x'), { code: 'refused_other_user' });
  assert.deepEqual(sent, []);
  await send('me', 'one'); await send('me', 'two');
  await assert.rejects(send('me', 'three'), { code: 'rate_limited' });
  assert.deepEqual(sent, [['me', 'one'], ['me', 'two']]);
  assert.deepEqual(refusals, ['refused_other_user', 'rate_limited']);
  assert.ok(send.sentIds.has('id1') && send.sentIds.has('id2'), 'sent ids are kept for the loop drop');
  await assert.rejects(send('me', ['a', 'b']), { code: 'bad_request' }, 'no bulk: one text per call');
});

test('pairing code: matches once, only before it expires, only the right code', () => {
  let t = 1_000_000; const { code, stored } = newPairingCode({ ttlMs: 60e3, now: () => t });
  assert.ok(!JSON.stringify(stored).includes(code), 'only the hash is stored');
  assert.ok(pairingMatches(stored, code, { now: () => t }));
  assert.ok(!pairingMatches(stored, `${code}x`, { now: () => t }));
  t += 60e3; assert.ok(!pairingMatches(stored, code, { now: () => t }), 'expired');
});
