# How Memev compares

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

Memev is a local-first memory and team channel for AI apps. This page states the facts about how
Memev works and the open standards it builds on, so you can compare its approach with hosted
alternatives on your own terms.

## The approach

| Question | Memev | A typical hosted memory service |
|---|---|---|
| Where your notes live | A folder of plain Markdown on your own computer | On the vendor's servers |
| Who can read them | You, unless you choose to share | The vendor, subject to its policy |
| Backup | A private GitHub repository under your own account | The vendor's storage |
| How apps receive context | The Model Context Protocol, an open standard | Usually a proprietary API |
| Team sharing | One channel between computers you own, with no server in the middle | Through the vendor's cloud |
| If you stop paying | The notes are plain files you keep | Access may end |
| Turning the cloud link off | The optional web link can be switched off | Often not applicable |

Memev keeps notes as plain Markdown, so they stay readable and portable with no special tool. It
hands context to apps over the Model Context Protocol, the open standard that many editors and
assistants already support. It backs up to a private GitHub repository under your own account.

## Sources

- Model Context Protocol, the open standard Memev uses to hand context to apps: https://modelcontextprotocol.io
- GitHub private repositories, where Memev stores your backup under your own account: https://docs.github.com/en/repositories/creating-and-managing-repositories/about-repositories
- CommonMark, the plain-text Markdown format Memev writes your notes in: https://commonmark.org

The "typical hosted memory service" column describes the common cloud-hosted pattern rather than any
single product. Check each product's own documentation for its current terms.
