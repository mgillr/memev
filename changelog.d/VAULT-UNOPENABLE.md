### Security

- One write can no longer leave the vault unable to open. A path with a control character, a note under an existing note, and a note over a folder with notes in it are refused before anything is logged; an empty folder a delete left behind is cleared first. A vault whose log already holds such a path opens and skips it, and the rest of the vault works.
