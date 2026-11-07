### Added

- `memev connect` now detects Grok Build (`~/.grok`) and adds a stdio `[mcp_servers.memev]` table to `~/.grok/config.toml`, the same way as for Codex: a `[mcp_servers.memev]` table the user already has is left as-is, and disconnect takes out only Memev's table. On Windows the table runs `node.exe` with the runtime script.
- docs/CLOUD.md covers Grok on the web, iOS and Android (custom connector), says Grok in the X app and the Microsoft Copilot app are not supported, and gives the admin routes for Microsoft 365 Copilot. None of these is tested live yet.
