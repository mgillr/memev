# Connector directory entry (draft)

This is draft text for a directory of remote connectors. It has not been submitted. Do not post it.

## Listing

- Name: Memev
- One line: A private link from a cloud AI app to the notes on your own computer. A personal setup turns it on. `--local-only` or `--org` keep it off.
- How the person gets an address: on their computer, `memev cloud url` prints a connector URL. That URL is a secret. It is not written in this draft.
- Shape of that URL, with the secret left out: `https://<address>/c/<token>/mcp`
- Apps that can send a header use the plain MCP URL and `Authorization: Bearer <token>`.
- After a personal setup the link is already on. Turn it off with `memev cloud off`, and back on with `memev cloud on`. `--local-only` and an organisation install (`--org`) leave it off. An organisation install stays off until `memev cloud on --yes`.
- A connector URL pasted into a coding app on a computer is refused. Those apps use `memev connect` and the pages in `docs/clients/`.
