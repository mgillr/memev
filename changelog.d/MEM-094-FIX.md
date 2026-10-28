### Fixed

- A seat is only ever one computer's. When a second computer has the same short name as the vault's own, its apps get `<app>@<machine>-2` (then -3 and so on) instead of sharing, and posting as, the first computer's seat.
- After `memev bus rename`, messages sent to the old name still reach the seat, holds and comms checks addressed to it still apply, the roster counts its earlier claims and status as its own, and the lead moves to the new name.
- Still to do: the examples in docs/BUS.md and in the bus tool descriptions still show `claude-code@host`.
