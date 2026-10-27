# Free

For one person on one computer. Complete, and never limited ([CHARTER.md](../../CHARTER.md)).

```mermaid
flowchart LR
    subgraph pc["Your computer"]
        apps["AI apps<br/>Claude Code, Codex, Gemini CLI,<br/>Cursor, Claude Desktop, Windsurf,<br/>VS Code, Zed"]
        memev["Memev<br/>127.0.0.1 only"]
        vault[("~/memev<br/>Markdown + git")]
        apps <-->|MCP and hooks| memev
        memev <--> vault
    end
    gh[("Your private<br/>GitHub repository")]
    web["ChatGPT, claude.ai"]
    vault -->|push every few minutes| gh
    web -.->|"secure link, per-app token<br/>(memev cloud off to stop)"| memev
```

## Included

- The vault, recall, the knowledge graph, claims and provenance
- Hooks in Claude Code, Codex and Gemini CLI, session-start hooks in Cursor, instructions in the
  other apps
- The quality check, review inbox, audit and `memev why`
- Signed contracts with local checks
- The comms bus: every AI app on your computer gets a seat, and you can coordinate them from one
  session ([BUS.md](../BUS.md))
- `memev doctor`
- The secure link for cloud AI apps (up to 5 connectors counted; nothing is refused)
- Backup to your own private GitHub repository

## Limits

- One computer per vault, with no licence and no network needed. Adding a second computer to the
  vault needs a licence: the vault refuses it with "This vault is licensed for 1 computer". Cloud AI
  apps through the secure link are not computers and are not refused.
- No user accounts: whoever has a token reaches what that token allows.
- Recall is keyword search. Paraphrases with no shared words are missed; optional local
  embeddings are planned.

## Setup

You, in a few minutes: see [Install](../../README.md#install). No account and no sign-up. GitHub
backup asks for one browser sign-in.

## Support

GitHub issues, best effort, no response time. Paid help is available by the hour: see
[services.md](services.md).

## Sovereignty

Everything stays on your computer except what you choose to send out: the GitHub backup (plain
Markdown in your private repository) and whatever recall returns to a cloud AI app through the secure
link. `memev init --local-only` keeps the secure link off, and the backup stays off until you run
`memev github setup`.

## Personal (draft)

One person, up to 3 computers and 10 cloud AI connectors, for $15/month or $144/year. The licence is
for that person and cannot be passed on. The AI apps on all three computers share one memory and
one comms bus, over the secure link, with a key for each computer.

This is an early-supporter price: it stays the same for as long as your subscription runs.

Planned, not built, and not part of the price: end-to-end encrypted sync between the computers, a
hosted encrypted backup and a stable address for the secure link. With sync, your notes would be
encrypted on your computers before they leave, so the sync service could not read them or search
them for you.
