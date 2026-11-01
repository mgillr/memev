### Fixed

- A vault's op log has one writer. The first writable open creates `.memev/oplog/LOCK` and any other open, in this process or another, fails with `VaultLocked` naming the holder's pid; before, with the daemon lock gone, two daemons could serve one vault and interleave records. The lock is renewed from a worker thread, and a stale one (its process gone, its pid reused, or another host or boot) is recovered under a mutex. A process that loses its lock writes nothing more.

### Added

- A read-only open of a vault (`new Vault(root, { readOnly: true })`) takes no lock and writes nothing, so a reader can run beside a live daemon. `memev runner on`, `off`, `status` and `watch` use it.
