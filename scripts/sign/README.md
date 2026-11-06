# The owner's signatures

`owner-sign.mjs` signs one contract with the owner's passphrase key, through memev's own `contractDraft` and `contractSign`. `owner-key-preload.mjs` holds the key: it asks on the terminal, decrypts in memory for one process, and writes no key to disk. SR-0.04 T9 builds this into `memev contract sign`; until then this is the route.

Run it in your own Terminal window, never through the `!` prefix of an assistant's prompt. Run it from a fresh clone at the commit you were given. To stop at the passphrase, press Ctrl-C.

Before asking for the passphrase it prints the clone's commit, both programs' sha256, the base commit, the contract's title, the gate's hash, the spec file's sha256 and the key id. The command you were given names the commit, the base, the gate's hash and the key id, and it refuses if any differs. The gate's hash is the one in the review records.

Before the passphrase it refuses, and signs nothing, on: a flag repeated, unknown or empty; no terminal; a key id, commit or gate hash other than the command names; a base that is not a commit behind the clone's HEAD; a clone with changes; any program other than the clone's own two; a key that is not encrypted or is readable by others; anything other than an empty file at `~/.config/memev-owner/view`; a spec the gate does not call SIGNABLE; a record that is not the spec's; a body with this title already in the signing vault, when the command supersedes nothing; a log it cannot write. A wrong passphrase, or a key other than the one named, also refuses. Left without the preload, the tool stops before it opens a vault.

If a check fails after the signature, it says `STOPPED AFTER SIGNING` and where the body is. That body must not be landed.

The limit, said plainly: both seats run as the same user on this machine. A passphrase protects against accident and an unattended seat. It does not protect against a changed program, `PATH`, `node` or shell start files, any of which could save what you type. These checks stop mistakes, not a same-user attacker. Only a key on another device removes this; that is the owner's choice.
