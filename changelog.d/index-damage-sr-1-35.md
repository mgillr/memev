### Changed

- The recall index carries checks of its own, so a damaged file is noticed and not served. A word's postings, each dictionary line, each snippet line and every file read whole are checked as they are read; every file's checksum is checked behind the start, by `memev doctor` and before a fold. A generation found damaged stops serving at once and is rebuilt from the notes, and until then recall says it is rebuilding instead of coming back empty. A failed rebuild says so and to run `memev restart`. A read that fails for a passing reason, such as too many open files, fails that one query and costs no rebuild.
- An index folder restored from an older copy, or whole lines cut from its overlay log, is noticed at the next start and rebuilt from the notes.
- `memev status` and `memev doctor` say when the index was found damaged and why, and doctor reports a daemon whose load has stopped moving instead of skipping it.
- A token limited to some paths sees only counts for what the sweep found outside them, in `/v1/status` and `memev_status`.
- `memev compact`, and any other command that opens the vault, refuses while a daemon is still loading it, and no opener removes an index folder another process is writing. `memev verify`, `memev contract` and `memev bus` say the daemon is loading rather than that it is not running.
- A note renamed only in letter case while Memev is stopped is one note with one hit on a disk that treats the two as one file.

### Fixed

- A null or wrong-shaped line in `.memev/notes.state` or `notes.journal`, or bad numbers in an index's `head.json`, cost a read instead of stopping the daemon from starting. An open that fails leaves no `daemon.loading` or `daemon.lock` behind.
- A symbolic link in the state folder is replaced, never written through: `index.seq`, `notes.journal`, `overlay.log`, `commit.seq`, a linked `index.seg` or generation folder.
- A half-written last line in a bus file no longer swallows the next acknowledged message.
- A bus message sent just before a hard kill is committed by the next start.
- A stale `daemon.loading`, `daemon.json` or `daemon.lock` naming a live process that is not this vault's Memev daemon no longer holds up `memev start`, and `memev stop` no longer kills that process. Where the system cannot say what a process is, a live pid counts as the daemon, as before; on Linux it reads `/proc` and needs no `ps`.
- `memev compact` folds the index even when its own save would have started a fold.
- The sweep no longer follows a linked folder, names what it could not read in status and in its log line, and `commit.seq` is private like every other state file.
