### Changed

- The bus stays quick as it grows. At 50 seats and 100,000 messages `memev bus roster` and `bus_tasks` answer in milliseconds, and sending or checking for messages no longer rereads the message file.
- A computer's bus message file now stops at 4 MiB and continues in `bus/log/<device>.<n>.jsonl`, so it can never reach the size at which GitHub refuses a backup. Older vaults keep their file, and older versions of Memev read the new files. One limit: going back to a version older than this after a bus file has rolled over can reuse message counters and leave a new message undelivered to a reader that has read past them.
