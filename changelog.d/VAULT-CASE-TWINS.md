### Fixed

- A note whose path differs from an existing note's only in letter case or Unicode form, such as `notes/A.md` beside `notes/a.md`, is refused before anything is logged, and the message names the existing note. On a case-insensitive disk the two were one file with two histories, so each write replaced the other's body.
