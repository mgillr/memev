# The owner's signatures

`owner-sign.mjs` signs one contract with the owner's passphrase key, through memev's own `contractDraft` and `contractSign`. `owner-key-preload.mjs` holds the key: it asks on the terminal, decrypts in memory for one process, and writes no key to disk. SR-0.04 T9 builds this into `memev contract sign`; until then this is the route.

Run it in your own Terminal window, never through the `!` prefix of an assistant's prompt. Run it from a fresh clone at the commit you were given. If Ctrl-C leaves your typing invisible, type `reset`.

Before asking for the passphrase it prints this program's sha256, the base commit, the contract's title, the spec file's sha256 and the key id. Compare them with what you were given. They are checked by you, not by the program.

It refuses, and signs nothing, on: no terminal; a wrong passphrase; a key id other than the one the command names; a key that is not encrypted, not Ed25519, or readable by others; anything other than an empty file at `~/.config/memev-owner/view`; a spec the red-team gate does not call SIGNABLE. Left without the preload, it fails before it can make a key.

The limit, said plainly: both seats run as the same user on this machine. A passphrase protects against accident and an unattended seat. It does not protect against a changed program, which could save what you type. That is why the run is from a fresh clone at a stated commit. Only a key on another device removes this; that is the owner's choice.
