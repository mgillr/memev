### Fixed

- `memev token rotate` on the admin token writes `.memev/admin.json` atomically with mode 0600 whatever files an interrupted rotate left behind, and no longer tells you to paste the cloud link again, since the admin token is never in a cloud link; it says `admin.json` holds the new secret.
