# Cloud-hosted deployment

Part of the [Memev documentation](README.md). The other option is [on-prem](deploy-on-prem.md).

> **Planned.** The cloud-hosted service is not available yet, and it has no date. Nothing on this
> page is available today, and nothing here is an offer.

## Who it is for

Cloud-hosted is for teams that use an external hosted AI provider, or a mix of hosted and local
models. You do not run the server; the operator does.

## What runs where

- The vault server runs on a host the operator manages.
- Your computers and AI apps connect to it.
- Calls to an AI provider are made by your own AI apps, with your own keys.
- Memev holds no provider keys and makes no model calls.

## What you keep

- Your own git backup remains possible: the vault is plain Markdown, and you push it to your own
  private repository.
- Export always works: you take your notes out at any time.

## Recording the choice

Record the choice in the vault config:

```sh
memev deployment set --mode cloud-hosted --ai hosted-api|mixed
```

The `--ai` value is `hosted-api` when your AI apps call a hosted provider and `mixed` when they
also use a local model. `memev deployment` shows the recorded mode and provider type, what runs
where, and the trial path that fits. The modes are `local`, `on-prem` and `cloud-hosted`; the
provider types are `hosted-api`, `internal-llm` and `mixed`.

## What a note sent to a hosted provider means

A note sent to a hosted AI provider leaves your control once sent. The provider holds it under its
own terms, and Memev cannot recall it. Routing restricted notes only to a local model is planned,
not built.

## Trial path

The self-serve Business trial (planned) fits cloud-hosted with hosted-api or mixed. It is free,
with no card, and the workspace is provisioned self-serve. The flow is in docs/CLOUD-TRIAL.md
(coming).

## Status

The service is planned and has no date. The command above works today and records the choice in
the vault config; it changes nothing else until the service is available.
