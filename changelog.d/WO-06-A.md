### Fixed

- With the relay switched off on a vault that was using it, the next sync runs through the git backup and the vault's tree is byte for byte what it was: nothing removed, nothing rewritten.
- The doctor names the fallback in one line on the backup check it already reports, saying the relay is off, the git backup is the path in use, and `memev cloud relay on` switches the relay back on. The line stays out of a session's context, and no new check id is added.
- With the relay configured but unreachable, the client reports the failure, reconnects on a growing pause (half a second, doubling up to a minute), and never blocks the daemon's other background jobs. `docs/RELAY.md` documents the fallback to the git backup.
