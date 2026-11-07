### Security

- `memev import --export` refuses a zip whose entry would inflate past 64 MiB, or the whole zip past 256 MiB, counted on the real output and not on what the zip's header declares.

- A remote setup session can now run what its allowlist accepts: `memev deployment set local` and `on-prem` work without a flag, `container`, which memev never held as a mode, is gone from the allowlist, and a licence file named in the session is read from the vault, where the allowlist checked it.

- The OAuth issuer now comes from `remote.issuer`, or the running relay or tunnel, and never from the Host header of the request. When upgrading: behind a reverse proxy or a tailnet with no tunnel or relay, discovery answers 503 until `remote.issuer` is set.

- A signed request stays used across a restart: the nonces in the skew window are on disk, pruned by age, before the request is served. A damaged store is set aside and the server keeps running, but it fails closed: signed requests may be refused for up to 5 minutes after the damage is found, because one already used could not be told from a new one.

- The relay client now refuses a peer whose certificate does not verify: besides the key the address is made from, the certificate must be signed by that key, in date and for that name, all checked before any of the request is sent.
