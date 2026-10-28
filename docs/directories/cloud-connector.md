# Connector directory entry (draft)

This is draft text for a directory of remote connectors. It has not been submitted. Do not post it.

## Listing

- Name: Memev
- One line: A private link from a cloud AI app to the notes on your own computer. It is off until you say yes when init asks, or run `memev cloud on`.
- How the person gets an address: on their computer, `memev cloud url` prints a connector URL. That URL is a secret. It is not written in this draft.
- Shape of that URL, with the secret left out: `https://<address>/c/<token>/mcp`
- Apps that can send a header use the plain MCP URL and `Authorization: Bearer <token>`.
- After a personal setup the link is off until you say yes when init asks on a terminal, or run `memev cloud on`. Turn it off with `memev cloud off`. `--local-only` and an organisation install (`--org`) skip the question and stay off.
- A connector URL pasted into a coding app on a computer is refused. Those apps use `memev connect` and the pages in `docs/clients/`.
