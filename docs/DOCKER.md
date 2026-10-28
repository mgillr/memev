# Docker

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

```sh
docker compose up -d
docker compose exec memev memev token issue my-app
```

`compose.yaml` publishes port 7787 on the host's loopback only (`127.0.0.1:7787`) and keeps the
vault in the `memev-vault` volume. The image runs as the unprivileged `memev` user and has a health
check on `/healthz`.

## Keep the port published on loopback only

Publish the port as `127.0.0.1:7787:7787`, as `compose.yaml` does. Inside the container the server
treats exactly one peer as local: the bridge gateway, which is the host. It finds that address from
the default route (`MEMEV_TRUST_GATEWAY=1`; set `MEMEV_GATEWAY` to override it). A request from any
other address is remote, and with remote access off, as in the image, it is refused.

If you publish the port beyond loopback (`0.0.0.0:7787` or another interface), machines on your
network can reach it. They are not the gateway, so they are not treated as local: they still need
remote access switched on and a remote token to do anything. But the health check and the invite
route answer without a token, and a remote token would be reachable from the network. Keep the
publish on `127.0.0.1` and reach the vault from the host only.

Point an app at `http://127.0.0.1:7787/mcp` with `Authorization: Bearer <token>`.

Inside the container the tunnel, the login service and app registration are off: the container
cannot see your apps or your login session. For cloud access, run the tunnel on the host
(`cloudflared tunnel --url http://127.0.0.1:7787`) and use a token issued with `--remote`.

`memev selftest` inside the image checks a throwaway vault end to end; `scripts/docker-smoke.sh` runs the full container check.

## Trial setup

The trial is free and runs on your own machine. The convergence engine is a separate component under its own licence and is not part of the image. publishing the image to a registry needs the owner go; build it locally today.

Three steps to a running trial:

1. Get the compose file. Copy `compose.trial.yaml` from the repository, or set `MEMEV_IMAGE` to a prebuilt image name.
2. Start it. Run `docker compose -f compose.trial.yaml up -d`. The port is published on `127.0.0.1:7787` only. Wait for the health check to pass: `docker compose -f compose.trial.yaml ps` shows `healthy`.
3. Install the trial licence. Run `docker compose -f compose.trial.yaml exec memev memev license install /vault/trial.license.json`. The licence file is a signed JSON document; the free tier needs no licence, but installing one records the trial.

Expected output for each step:

Step 1: the file `compose.trial.yaml` is in the repository root.

Step 2: `docker compose -f compose.trial.yaml up -d` prints `Container memev-1 Started`. `docker compose -f compose.trial.yaml ps` prints `memev-1  Up  healthy`.

Step 3: `docker compose -f compose.trial.yaml exec memev memev license install /vault/trial.license.json` prints `installed licence <id> (valid) in /home/memev/.config/memev/license.json`.

`scripts/docker-trial-smoke.sh` runs the whole path on a machine with Docker: build, up, wait for healthy, doctor, licence install of a throwaway test licence, down with volumes removed. Run it by hand, not in CI.
