### Changed

- The bus stays quick as it grows. At 50 seats and 100,000 messages `memev bus roster` and `bus_tasks` answer in milliseconds, and sending or checking for messages no longer rereads the message file.
- A computer's bus message file now moves to `bus/log/<device>.<n>.jsonl` at 4 MiB and starts again, so it can never reach the size at which GitHub refuses a backup. Older versions of Memev read every one of these files and, if a computer goes back to one, carry on from the real message counter.
