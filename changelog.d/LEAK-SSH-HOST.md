### Fixed

- The leak scan accepts `git@ssh.github.com`, the SSH host of the port 443 fallback, as a remote and not as an e-mail address. Real addresses and look-alike hosts are still flagged, and a test covers both.
