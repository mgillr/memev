### Fixed

- A contract's request is no longer cut at 4,000 characters without a word. A signed body carries the whole request, up to 16,000 characters, and a longer one is refused at the draft, naming both lengths. The owner's signing route refuses it before the passphrase, and compares the drafted request with the spec's before it signs.
