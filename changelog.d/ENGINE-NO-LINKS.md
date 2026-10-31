### Security

- The bus and the sync no longer write through a symbolic link in the vault. A link on the way to the bus's seats, message logs, heartbeats or lead record refuses the write; the session-start lead mark skips it; the sync writes neither the address record nor the writers record through a link, and a merge conflict whose path goes through one is aborted before anything is written. A link can arrive from disk or with a synced backup.
