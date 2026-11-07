### Added

- `memev bus since --from SEAT --to SEAT` filters what it shows by sender and recipient, and marks nothing read.
- `memev bus unread --peek` looks without marking anything read, without recording presence and without answering a comms
  check, so a viewer such as the desktop app never looks like a seat at work. `bus_unread` takes `quiet` for the same.
- `memev runner status --days N --json` adds runs per day for the last N days, from the kept run times.
