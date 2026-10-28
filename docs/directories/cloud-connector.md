# Connector directory entry (draft)

This is draft text for a directory of remote connectors. It has not been submitted. Do not post it.

## Listing

- Name: Memev
- One line: A private link from a cloud AI app to the notes on your own computer. It stays off until you turn it on.
- How the person gets an address: on their computer, `memev cloud url` prints a connector URL. That URL is a secret. It is not written in this draft.
- Shape of that URL, with the secret left out: `https://<address>/c/<token>/mcp`
- Apps that can send a header use the plain MCP URL and `Authorization: Bearer <token>`.
- Turn the link on with `memev cloud on`. Turn it off with `memev cloud off`. An organisation install stays off until `memev cloud on --yes`.
- A connector URL pasted into a coding app on a computer is refused. Those apps use `memev connect` and the pages in `docs/clients/`.
