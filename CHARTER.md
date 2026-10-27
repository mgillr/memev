# The Memev Charter

1. **The free tier is never limited.** One person on one computer gets all of Memev: the vault,
   recall, the graph, contracts, the doctor, every local AI app, cloud AI connectors through your own
   tunnel, and backup to your own GitHub. No feature that works for free today will be taken away,
   capped, slowed or put behind a prompt to pay.
2. **Paid means hosted services and multi-computer or team use, around the core, never pieces of
   it.** Money comes from things that cost money to run (hosted sync, hosted backup, a stable relay
   address) or that only organisations need (several computers on one vault, shared team vaults,
   SSO, audit export). They are added next to the free tier; nothing is removed from it to make room.
3. **Your vault never talks to us.** Memev has no telemetry. A licence is a signed file checked on
   your computer without the network. Only a hosted service you switch on talks to its server, and
   then only with a licence id and encrypted data.
4. **You are never locked out.** If a licence lapses or a paid service stops, your vault stays on
   your computer, readable and writable, as Markdown in git.
5. **Everything is visible.** The code that counts computers or reads a licence is in this
   repository for anyone to read.

**This is a review gate.** A change that limits, slows, nags or removes anything in the free tier is
refused in review, whoever proposes it. Code that counts or reports must say "report only" until a
public decision says otherwise, and it may never apply to the free tier.

Today `entitlements.can()` answers with free-tier behaviour for everything and enforcement is off
(`src/engine/entitlements.mjs`). `test/licensing.test.mjs` checks that requests over the free
computer count, with reused credentials or bad device signatures, are still served.
