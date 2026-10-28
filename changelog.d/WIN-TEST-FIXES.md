### Fixed

- The Windows test job on main now passes: tests that check the posix launcher form say so, the temporary folder cleanup retries when Windows still holds a folder, and the vendored parser keeps its bytes on checkout so its checksum test holds.
