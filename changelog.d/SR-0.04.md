### Security

- `memev import --export` refuses a zip whose entry would inflate past 64 MiB, or the whole zip past 256 MiB, counted on the real output and not on what the zip's header declares.
