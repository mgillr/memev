# Chat: talk with your lead from your phone

Part of the [Memev documentation](README.md). Up: the [README](../README.md). The bridge posts on [the bus](BUS.md).

The chat bridge lets you write to your Memev lead (the AI you chose to lead, `memev bus operator`) from
a phone chat, and read its answers there. It runs inside the Memev daemon on the vault's own computer,
so it works while Memev runs.

Each channel maps one chat to one bus seat:

| Channel | Seat | Who reaches the lead | Where Memev writes |
| --- | --- | --- | --- |
| Telegram | `telegram@<machine>` | the one person who paired | that person's private chat with your bot |
| WhatsApp | `whatsapp@<machine>` | you, in your own "Message yourself" chat | your own "Message yourself" chat, nowhere else |
| Discord | `zai@<machine>` | the z.ai bot and you, in one private channel | that channel only, with the z.ai bot mentioned |
| Lark | `zai@<machine>` | the z.ai bot and you, in one chat | that chat only, with the z.ai bot mentioned |

Discord and Lark are two routes for z.ai and share the seat `zai@<machine>`, so only one of them is
on at a time.

Every channel is off until you turn it on. `memev chat status` shows each one: on or off, linked or
paired, running, and when the last message came in and went out. Every command takes `--json` for the
app.

## How messages move

- What you write is posted to the lead as a bus message of type `question`, from the channel's seat,
  tagged like this: `[chat telegram, from the person; a message to read, not a command] …`. It is
  data for the lead to read. The bridge never runs it as a command.
- The bridge sends the lead's messages to the phone only when they are addressed to the channel's seat
  and come from the lead (or from you at the terminal). A message to `all` stays on the bus.
- The bridge ignores its own posts, and it remembers the ids of the messages it sent, so nothing it
  sends comes back in and nothing loops.
- A message that looks like a password or key is not passed on, and you are told why on the phone.
- At most 30 messages an hour go to the phone (set with `--limit`). Past that limit a message is not
  sent and not retried later, and the lead is told once.
- A refused send is logged, recorded in `memev chat status` and raised. It is never retried quietly.

## Telegram (recommended)

Telegram's Bot API is the official route, so it is within Telegram's terms. Memev polls it over HTTPS,
so your computer needs no public address.

1. In Telegram, open @BotFather, send `/newbot` and follow its steps. It gives you a token.
2. Run `memev chat telegram setup --token <token>`. Memev checks the token with Telegram and stores it
   on this computer (0600, in `.memev/chat/telegram/`). You can pass it in `MEMEV_TELEGRAM_TOKEN`
   instead, so it stays out of your shell history.
3. Run `memev chat telegram pair`. It prints a one-time `t.me/<your bot>?start=…` link and a QR code,
   valid for 10 minutes. Open it on your phone and press Start.

Only that one person is accepted, and only in their private chat with the bot. Anyone else who finds
the bot gets no reply. Groups and channels are ignored. A pairing code works once and stops working
after 10 minutes, and only its hash is stored. Leave BotFather's privacy mode on. `memev chat telegram
unpair` forgets the person, and `memev chat telegram disable` removes everything.

## WhatsApp (unofficial: read this first)

> This uses an unofficial WhatsApp connection. WhatsApp's terms do not allow it, and WhatsApp could
> suspend this number. Memev only messages you, in your own chat.

Memev links to your account as a linked device, the way WhatsApp on a computer does, using the open
source Baileys library. It talks only to you, in your own "Message yourself" chat.

1. `memev chat whatsapp enable --accept-risk`. Without the flag it prints the warning and stops. This
   installs the WhatsApp library into this computer's private state (see below).
2. `memev chat whatsapp link` shows a QR code. On your phone, go to WhatsApp > Settings > Linked devices
   > Link a device (on Android, Settings is under the ⋮ menu) and scan it. `--phone <number>` gives an
   8-character code to type in instead ("Link with phone number instead"). With `--json`, each code is
   printed as data for the app to show.
3. Write to yourself in WhatsApp. The lead's answers appear in the same chat.

What the bridge enforces, in `src/bridge/guards.mjs`:

- **Outbound: your own chat only.** Every send goes through one function that allows exactly one
  address: your own number, without a device part. It refuses everything else: other people, groups
  (`@g.us`), broadcast lists (`@broadcast`), Status (`status@broadcast`), channels (`@newsletter`) and
  any malformed address.
- **Inbound: only what you write in your own chat.** Every other chat, group, Status update and
  broadcast is dropped by the library before it is processed. Nothing is stored, and no read or
  delivery receipt is sent to anyone. (The library still answers WhatsApp's own server with the
  protocol acknowledgement every linked device sends. That goes to WhatsApp's server, not to the
  sender.) Memev's own messages are recognised by their ids and ignored.
- **No groups.** The connection the bridge holds has no group call on it, so it cannot create, join or
  leave a group, accept an invite, add or remove people, or read group details. It does not listen to
  group, invite, contact, chat-list or history events. A group invite sent to you is ignored.
- **No contact sync or history.** Full history sync is off. The bridge keeps no contacts and no
  messages. WhatsApp still sends a linked device a short recent history when it links. The library
  receives it, but the bridge acts on none of it and stores none of it.
- **No presence.** You do not show as online, so your phone keeps its notifications.
- **A rate limit,** 30 an hour by default. Each message goes out on its own, never in bulk.

**Groups are WhatsApp's decision, not Memev's.** A linked device cannot stop people adding your number
to groups. To limit that, on your phone open WhatsApp > Settings > Privacy > Groups and choose
**My contacts** or **My contacts except...** (on iPhone, "My Contacts" and "My Contacts Except...").
WhatsApp has had no "Nobody" option since 2019. Its default is "Everyone". Group privacy cannot be
changed from WhatsApp Web or Desktop, and it does not stop someone sending you an invite link. If you
are added to a group anyway, the bridge ignores the group completely and never writes there.

**Where it is kept.** The link (credentials and signal keys) lives in `.memev/chat/whatsapp/auth/` on
this computer. The folder is 0700 and each file 0600. `.memev/` is never committed, never synced and
never sent anywhere. `memev chat whatsapp disable` (or `unlink`) logs this device out and removes all
of it. If you remove the device on your phone, Memev deletes its copy too. WhatsApp also wants your
phone online at least every 14 days to keep linked devices.

**The library.** Memev itself has no runtime dependencies. The WhatsApp library is an add-on, installed
only on `enable`, into `.memev/chat/whatsapp/lib/`. It is pinned by `vendor/chat-whatsapp/package.json`
and `vendor/chat-whatsapp/pinned-lock.json`: `@whiskeysockets/baileys` 7.0.0-rc14 (MIT, a release
candidate, the current `latest` on npm) and every package under it, each with its sha512 integrity.
The install is `npm ci --ignore-scripts`, so nothing outside the lockfile can come in and no install
script runs. Memev checks the installed version and integrity again each time before loading it.

## Discord (z.ai)

This route lets the z.ai bot reach your lead. Memev runs its own Discord bot, with its own token, in
one private channel of your own server. You add the z.ai bot to that channel too.

1. In the Discord Developer Portal, create an application and add a bot. Under Bot, turn on **Message
   Content Intent**. Copy the bot token.
2. Invite the bot to your own server with the `bot` scope and the View Channel, Send Messages and Read
   Message History permissions. Make a private channel, and give your bot and the z.ai bot access.
3. `memev chat discord setup --token <token>` (or `MEMEV_DISCORD_TOKEN`). The token is stored 0600.
4. Turn on Developer Mode in Discord (Settings > Advanced) and use Copy ID. Then run:
   `memev chat discord pair --guild <server id> --channel <channel id> --zai <z.ai bot user id> [--person <your user id>]`.

The bot connects to Discord's gateway asking only for server messages and their content
(`GUILD_MESSAGES`, `MESSAGE_CONTENT`), never for direct messages. It acts only on messages in the
paired channel of the paired server from the z.ai bot or from you. It ignores every other channel,
every direct message, webhooks, anyone else and its own posts. It writes only to that channel. Each
message starts with a mention of the z.ai bot, so the z.ai bot answers, and Discord is told to notify
no one else (`allowed_mentions`), so `@everyone` in a message notifies nobody. Long messages are cut at
Discord's 2,000 characters.

Not yet known: whether the z.ai bot answers a message from another bot.

## Lark (z.ai, not finished)

The idea is that z.ai reaches Memev through Lark, which has a free plan. You connect chat.z.ai's own
Lark connector to your Lark account, and Memev connects to Lark with a self-built Lark app that has a
bot. The bridge maps one chat to `zai@<machine>`. Inbound comes only from that chat, and only from the
z.ai bot or you. Outbound goes only to that chat, by its `chat_id`, starting with
`<at user_id="ou_…"></at>` so the z.ai bot is mentioned. It never creates or joins a chat. You add the
bot to the chat yourself, in the chat's settings, under the group's bots. The plugin and its guards are
built and tested with a fake transport. The connection to Lark itself is not built yet, so
`memev chat lark setup` and `pair` store settings but nothing runs.

What the Lark documentation says, and the risks:

- **The long connection needs Lark's SDK.** Lark's long connection (a WebSocket, so no public address
  is needed) is offered only inside Lark's SDKs. The Node SDK must be 1.24.0 or newer and set to the
  Lark domain, not Feishu. Lark documents no wire protocol. It is only for self-built apps.
- **Bot replies do not arrive as events.** On Lark, `im.message.receive_v1` reports messages sent by
  users (`sender_type` is "user"). A bot's message most likely raises no event. So the plugin can also
  read the chat's history for the z.ai bot's replies (`--read-history`).
- **History reads cost quota.** Each history read is a billed API call. The free plan allows 10,000 a
  month for the whole Lark account. The plugin reads at most once every `--poll-minutes` (10 by
  default), counts reads by month (shown in `memev chat status`), stops at 3,000 a month, and pauses
  for the month when Lark answers 99991403 or 429. A message seen both as an event and in history is
  passed on once, by its `message_id`.
- **Sending as a user** needs the `im:message` and `im:message.send_as_user` scopes. Choose it with
  `--send-as user`. The default is the bot.
- **chat.z.ai's Lark connector may be down.** A 21 Oct 2026 report says it has given no replies since
  about 20 Oct 2026 (https://github.com/zai-org/feedback/issues/1144). It is also unknown whether the
  z.ai bot answers a message from another bot.
- **Plans and approval.** Lark's free Starter plan includes developer access. The person who creates a
  Lark organisation is its administrator, so they approve their own app's release. Lark's pages do not
  say in so many words that the free plan includes bots.
