# The Memev Charter

1. **The free tier is never limited.** One person on one computer gets all of Memev: the vault,
   recall, the graph, contracts, the doctor, every local AI app, cloud AI connectors through your own
   tunnel, and backup to your own GitHub. No feature that works for free today will be taken away,
   capped, slowed or put behind a prompt to pay.
2. **Paid means hosted services and multi-computer or company use, around the core, never pieces of
   it.** Money comes from things that cost money to run (hosted sync, hosted backup, a stable relay
   address) or that only organisations need (several computers on one vault, company vaults,
   SSO, audit export). They are added next to the free tier; nothing is removed from it to make room.
3. **Your vault never talks to us.** Memev has no telemetry. A licence is a signed file checked on
   your computer without the network. Only licence information passes between an install and our side:
   a licence key goes out once, to activate, and a signed licence comes back. Vault data never goes to the licence
   server. A hosted service you switch on (none exists yet) talks only to its own server, and only with a
   licence id and encrypted data. The one anonymous milestone report is off unless you turn it on.
4. **You are never locked out.** If a licence lapses or a paid service stops, your vault stays on
   your computer, readable and writable, as Markdown in git.
5. **Everything is visible.** The code that counts computers or reads a licence is in this
   repository for anyone to read.

**This is a review gate.** A change that limits, slows, nags or removes anything in the free tier is
refused in review, whoever proposes it.

The one limit Memev applies is how many other computers can be added to a vault. It was decided in
October 2026 and never touches the computer the vault runs on. Each added computer makes its own
device key and signs its requests with it, so a copied configuration does not work anywhere else.
The vault refuses to add a computer past the number in its licence; with no licence that number is
one, the vault's own computer, which keeps everything in point 1. When a licence runs out and its
grace period ends, no computer can be added and the ones already added can read but not write. The
vault's own computer keeps reading and writing (point 4). Cloud AI connectors are counted, not
limited.

The code is in `src/engine/entitlements.mjs`, `src/engine/devices.mjs` and
`src/engine/license.mjs`. `test/seats.test.mjs` checks the limit and checks that one computer with
no licence gets everything.
