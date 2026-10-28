# The relay protocol: a stable address for a vault

A vault on your computer needs an address that cloud AI apps and your other computers can use, and the
address of a quick tunnel changes whenever it restarts. A relay gives the vault one name that stays the
same. This page is the protocol, the client in `src/cli/relay.mjs` and the relay for development and tests
in `src/server/relay-dev.mjs`. It is off until you switch it on, and Memev has no relay built in: you give
the client the address of one.

The hosted relay that runs this protocol as a service is separate work. Nothing here depends on it, and
nothing here is a promise about when it exists.

## What it guarantees

- **The same address after every restart.** The name is made from a key the vault creates once, so a new
  process, a new port or a new computer with the same key is at the same address.
- **The relay only forwards.** A request is encrypted from the caller to the vault. The relay passes the
  bytes along and cannot read them, so it never sees a token, a path or a memory. It does see that
  something connected to a name, when, and how many bytes, because that is what forwarding is.
- **Whoever holds the key owns the name.** Nobody else can take the address, and a caller can check that
  what answers under it holds the key.
- **What arrives is remote.** Whatever comes through the relay reaches the vault as a remote request and
  gets the same rules as a request through a tunnel: remote access must be on, the token must be a remote
  one, and a computer signs every request with its own device key.

## The name

The vault makes one P-256 key and keeps it in `.memev/relay.json` (readable only by you). Its name is

    id = first 32 characters of base32(sha256(public key in SPKI DER form)), lower case, alphabet a-z2-7

and its address is `https://<id>.<domain>`, where the domain is the one the relay serves. The private key
never leaves the vault. The same key makes a self-signed certificate for that name, which is what the
vault shows to a caller.

## The three connections

All messages on the first two are one JSON object per line.

**1. Control.** The vault opens one outbound connection to the relay and keeps it.

    vault -> relay   {"t":"hello","v":1,"pub":"<SPKI DER, base64>"}
    relay -> vault   {"t":"challenge","nonce":"<24 random bytes, base64>"}
    vault -> relay   {"t":"auth","sig":"<base64 ECDSA-SHA256 over: memev-relay-v1 control <id> <nonce>>"}
    relay -> vault   {"t":"ready","id":"<id>"}

The relay works out the id from the public key itself and checks the signature against that key, so only
the holder of the key can hold the name. A vault that connects again (it restarted) takes the name back
and the old connection is closed. `{"t":"ping"}` from the vault is answered with `{"t":"pong"}`; the vault
reconnects with a growing pause (half a second up to a minute) when the connection goes.

**2. A caller connects.** Someone opens a TLS connection to the relay with the vault's name as the server
name. The relay reads the server name from the TLS hello, and nothing else, and looks up the name. An
unknown name, or something that is not TLS, is closed. For a known name it makes a random session id,
keeps the caller's bytes and tells the vault:

    relay -> vault   {"t":"open","sid":"<32 hex>","peer":"<caller address>"}

**3. Rendezvous.** The vault opens a second outbound connection and says which session it is answering,
signed:

    vault -> relay   {"t":"accept","id":"<id>","sid":"<sid>","sig":"<signature over: memev-relay-v1 accept <id> <sid>>"}
    relay -> vault   {"t":"ok"}

From then on the connection carries raw bytes, in both directions, between the caller and the vault. The
caller's first bytes, which the relay kept, are sent first. The TLS session is between the caller and the
vault: the vault ends it itself, with its own certificate, and the relay is only a pipe.

Limits in the development relay: five seconds for a connection to say what it is, ten seconds for a vault
to answer an `open`, at most 32 waiting connections per name, lines of at most 4 KB.

## What the vault does with a connection

The vault ends the TLS session and runs an HTTP server on the result. Each request is passed to the daemon
on this computer with every proxy header the caller sent removed and its own added (`x-forwarded-for` with
the caller's address as the relay reported it), so the daemon treats it as remote even when the caller
claims `Host: localhost`. The response goes back the same way.

## Who trusts what

| | Can see | Cannot |
|---|---|---|
| the relay | the vault's name, the caller's address, times and sizes | any token, path, header, body or memory; the vault's key |
| the vault | everything in its own requests | nothing about other vaults |
| a caller | its own requests | the vault's key |

A caller with no certificate authority to lean on (a computer you added yourself) checks the vault by its
name: the certificate must be made from the key the name is made from (`relayFetch` in
`src/cli/relay.mjs` does this). A cloud AI app uses an ordinary certificate check, which needs a
certificate a public authority issued for the name. A service that offers this has to get that
certificate for the vault without ever holding the vault's key (the vault makes the request, the relay
only publishes the DNS record it is asked to). The development relay does not do that, so with it the
cloud-app path is tested with the vault's own certificate.

## Turning it on

    memev cloud relay on --url relay://host:port --domain NAME
    memev cloud relay status
    memev cloud relay address
    memev cloud relay off

The setting is in the vault's `.memev/config.json` under `remote.relay` and is off on every install. With
it off the daemon opens no connection. A valid Personal licence can omit `--url` and `--domain` when
`default_url` and `default_domain` are already in that setting: the client uses those, and no address is
built in. Any other licence still has to pass both. The hosted relay is planned. `memev cloud relay address` prints the address and works before the
relay is reachable, so you can give it to an app first. Remote access (`memev cloud on`) must be on, or the
vault refuses what arrives. The address is kept when you switch the relay off.

## The relay for development and tests

`createRelay()` in `src/server/relay-dev.mjs` runs on this computer and implements what is above. It
imports nothing of the vault. Its `tap` option is called with every chunk it handles, which is how the
tests show that no token passes through it in a readable form.

    import { createRelay } from './src/server/relay-dev.mjs';
    const relay = createRelay({ port: 0, tap: (e) => log(e.dir, e.bytes.length) });
    const port = await relay.listen();
