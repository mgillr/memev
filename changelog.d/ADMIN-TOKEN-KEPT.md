### Fixed

- The vault's admin token can no longer be lost by accident. It is not listed as a device, so `memev devices remove`, `revoke` and `rotate` never reach it (an install that already lists it gets a refusal naming `memev token`); `memev token revoke` refuses the last live admin token; and `memev token rotate` on the admin token writes the new secret into `.memev/admin.json` with no expiry.
