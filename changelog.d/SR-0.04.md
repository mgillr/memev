### Security

- `memev import --export` refuses a zip whose entry would inflate past 64 MiB, or the whole zip past 256 MiB, counted on the real output and not on what the zip's header declares.

- A remote setup session can now run what its allowlist accepts: `memev deployment set local` works without a flag, and a licence file named in the session is read from the vault, where the allowlist checked it.
