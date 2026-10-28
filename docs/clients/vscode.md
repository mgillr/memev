# VS Code

Id: `vscode`

`memev init` connects this app when it finds the VS Code user folder. To connect it yourself:

```sh
memev connect vscode
```

Memev adds an MCP server named `memev` to `Code/User/mcp.json`, under `servers`, running `memev mcp --client vscode`.

Mode: instructions. The app is told to call `memev_session_start` first, `memev_recall` before answering from memory, and `memev_checkpoint` before long work ends. If it follows those instructions it behaves much like an app with hooks. If it does not, ask it once in the session.

After connecting, reload the window (Developer: Reload Window).

Before it edits a file, Memev saves a copy under `~/.config/memev/backups/`. Undo with:

```sh
memev disconnect vscode
```
