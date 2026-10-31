### Security

- memev never follows a symbolic link inside the vault. A link to a file outside is not read into the log, a write, append or delete through a linked file or folder is refused and lands nowhere, a note replaced by a link is never rebuilt through it, and a dangling link named like a note no longer stops the vault opening. Before, a link that a backup pull checked out could leak a file from outside the vault to any reader, or let a write-scoped token write files outside it.
