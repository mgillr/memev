### Fixed

- `memev init --no-connect` now keeps every AI app unconnected until you connect it: it also turns off the daemon's background connect, which used to connect each app it found a few seconds after Memev started. The daemon reads that setting on every run, so it holds for a daemon that is already running. `memev connect <app>` connects one app and leaves the background connect off; `memev connect` with no app connects every app it finds and turns it back on. The install runbook and the AI apps page say so (issue 284).
