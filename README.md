# Memev

One memory shared by every AI session you run.

Memev is a local MCP server over a Markdown vault that you own and that git keeps. Claude Code, Codex,
Gemini CLI, Cursor, Claude Desktop, Windsurf, VS Code and Zed all read and write the same vault, so a
decision made in one session is there in the next, in another app, and after a context compaction.

- **Local first.** The vault is plain Markdown in `~/memev`. Every change goes through an append-only,
  checksummed log first, so nothing is lost, and git records every change.
- **Hands-off.** `memev init` finds your AI apps and connects them: MCP server, hooks where the app
  has them, and a short instruction block. Each session starts with a resume card, each prompt gets
  the few most relevant memories, and state is saved before a compaction. Nothing to remember to call.
- **A knowledge graph, not a pile of notes.** Entities, links, and claims with a status (fact, theory,
  conjecture) that rises and falls with evidence, plus provenance for every claim.
- **Reachable from cloud apps.** A private tunnel is on by default so claude.ai or ChatGPT can use the
  same vault. `memev cloud off` turns it off.
- **No dependencies, no telemetry.** Node 22 or newer, nothing else.

## Start

```sh
npx memev init
```

That creates the vault, starts Memev, connects every AI app it finds and prints a short checklist.
See [docs/QUICKSTART.md](docs/QUICKSTART.md).

## Documentation

| | |
|---|---|
| [Quickstart](docs/QUICKSTART.md) | install, first session, everyday commands |
| [AI apps](docs/CLIENTS.md) | what is changed in each app, hooks vs instructions, undoing it |
| [Cloud access](docs/CLOUD.md) | the tunnel, connector URLs, turning it off |
| [GitHub backup](docs/GITHUB.md) | `memev github setup` |
| [Docker](docs/DOCKER.md) | running Memev in a container |
| [Contracts](docs/CONTRACTS.md) | signed, immutable work contracts |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | `memev doctor` and common fixes |
| [Security](SECURITY.md) and [threat model](docs/THREAT-MODEL.md) | |
| [Design](docs/DESIGN.md) | log, index, graph, recall, scale |
| [Hands-off runtime](docs/MAPPING.md) | everything Memev does without being asked |

## License

Apache-2.0. Includes a modified copy of Proofline (Apache-2.0); see [NOTICE](NOTICE).
