### Added

- `memev discover` (and `--json`) lists every AI app on the computer and how it was found: Windows Uninstall entries
  (a blank install folder falls back to the icon's folder), Microsoft Store packages, known folders, macOS app bundles,
  Linux `.desktop` files and commands on `PATH`. It reads names only and runs nothing but the system `reg.exe` on Windows.
- The ChatGPT desktop app, found from its app bundle or Store package, is configured through the Codex settings it
  shares with the Codex CLI and reported configured, not connected, until a session proves it loads them.
- Grok Bot is found apart from Grok Build and shown as one step by hand with the address to copy; Microsoft Copilot is
  found and listed as not connectable.
- `memev connect --json`: each app's status, files changed, backups, bus seat and restart line, and the lead.
- `memev bus roster --json` marks seats `registered`, so a lead can be chosen before its app's first session.
- `memev doctor --fix --safe-only` runs only the fixes that are not destructive; every warning names a fix or a
  sentence of what to do by hand, and the app checks name the apps concerned.

### Fixed

- The Claude desktop app installed from the Microsoft Store gets the settings file it really reads, inside its package.
- A Codex or Grok Build `config.toml` that does not parse is no longer appended to; the app is reported failed.
- Disconnecting one of two apps that share a settings file keeps the entry the other still reads.
