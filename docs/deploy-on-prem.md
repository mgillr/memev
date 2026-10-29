# On-prem deployment

Part of the [Memev documentation](README.md). The other option is [cloud-hosted](deploy-cloud.md).

## Who it is for

On-prem is for teams with an internal model, strict data residency, or a compliance-led or
air-gapped organisation. You run the server; nothing of yours runs on a host you do not control.

## What runs where

- The vault server runs on your own servers.
- Any internal model stays inside your environment.
- Memev holds no provider keys and makes no model calls.

## Air-gapped limits

An air-gapped install can't use a cloud AI service or the hosted relay, by design: the one AI
provider is a model inside your environment. The same limits are stated in
[corporate.md](tiers/corporate.md).

## Recording the choice

Record the choice in the vault config:

```sh
memev deployment set --mode on-prem --ai internal-llm|mixed
```

The `--ai` value is `internal-llm` when your AI apps call a model inside your environment and
`mixed` when they also call a hosted provider. `memev deployment` shows the recorded mode and
provider type, what runs where, and the trial path that fits. The modes are `local`, `on-prem`
and `cloud-hosted`; the provider types are `hosted-api`, `internal-llm` and `mixed`.

## What a note sent to a hosted provider means

If your AI apps also call a hosted provider, a note sent to that hosted AI provider leaves your
control once sent. The provider holds it under its own terms, and Memev cannot recall it. Routing
restricted notes only to a local model is planned, not built.

## Running the server

Run the vault server in a container with the image and compose file in this repository; see
[DOCKER.md](DOCKER.md).

## Trial path

The sales-assisted pilot (planned) fits on-prem with internal-llm or a compliance review. The
size is set by order form and the term starts at licence install. The trial licence itself is
free, and installing it yourself with the container image is free. Setup done by the operator is
a paid service, quoted per the rate card in [services.md](tiers/services.md). The operator is
named in the order form.
