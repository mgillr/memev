### Fixed
- A note too large for the conflict reader is no longer recorded as deleted by both computers: the reader uses the engine buffer cap, a failed read is reported, and a conflict with an unreadable side leaves the merge for memev doctor instead of sending anything.
