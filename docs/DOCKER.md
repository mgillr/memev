# Docker

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

```sh
docker compose up -d
docker compose exec memev memev token issue my-app
```

`compose.yaml` publishes port 7787 (or `MEMEV_PORT`) on the host's loopback only (`127.0.0.1:7787`)
and keeps the vault and the config folder in the `memev-vault` volume. The image runs as the
unprivileged `memev` user and has a health check on `/healthz`.

## Persistent data

The vault lives in the named volume `memev-vault`, mounted at `/vault` inside the container
(`MEMEV_ROOT=/vault`). The config folder lives there too: the image sets
`MEMEV_CONFIG_DIR=/vault/.memev/user-config`, and that folder holds the signing key for contracts,
the licence, the trial record and the device key. It is inside `.memev/`, which the vault's git
ignores, so none of it is committed or pushed to a backup. Everything the daemon writes, the notes,
the op-log, the tokens, the git history and the config folder, is in that volume. `docker compose down` stops the container and keeps the volume; the
next `docker compose up -d` starts on the same data. Only `docker compose down -v` removes the
volume and the data in it.

## Ports

Publish the port as `127.0.0.1:7787:7787`, as `compose.yaml` does. `MEMEV_PORT` (7787 in the image)
is the port the daemon listens on inside the container; `compose.yaml` publishes the same port on
loopback and the health check probes it, so to move it, set `MEMEV_PORT` when you run
`docker compose`. Inside the container the server
binds `0.0.0.0` (`MEMEV_BIND`) so the compose port mapping reaches it, and it treats exactly one
peer as local: the bridge gateway, which is the host. It finds that address from the default route
(`MEMEV_TRUST_GATEWAY=1`; set `MEMEV_GATEWAY` to override it). A request from any other address is
remote, and with remote access off, as in the image, it is refused.

If you publish the port beyond loopback (`0.0.0.0:7787` or another interface), machines on your
network can reach it. They are not the gateway, so they are not treated as local: they still need
remote access switched on and a remote token to do anything. But the health check and the invite
route answer without a token, and a remote token would be reachable from the network. Keep the
publish on `127.0.0.1` and reach the vault from the host only.

Point an app at `http://127.0.0.1:7787/mcp` (the port in `MEMEV_PORT` if you set one) with `Authorization: Bearer <token>`.

Inside the container the tunnel, the login service and app registration are off: the container
cannot see your apps or your login session. For cloud access, run the tunnel on the host
(`cloudflared tunnel --url http://127.0.0.1:7787`) and use a token issued with `--remote`.

## Permissions

The image creates the `memev` user and group and runs the daemon as that unprivileged user
(`USER memev`); nothing in the container runs as root. The volume is owned by `memev`, so the
daemon can read and write it, and the private state files keep their `0600` mode inside the
volume.

## Health check

The image carries a `HEALTHCHECK` that probes `/healthz` on the daemon's port
(`http://127.0.0.1:7787/healthz` unless `MEMEV_PORT` says otherwise) every 30 seconds
(`--interval=30s`), gives each probe 3 seconds (`--timeout=3s`), counts the container unhealthy
after 3 failed probes (`--retries=3`) and does not start counting failures for the first 10
seconds (`--start-period=10s`). `docker compose ps` shows the state; wait for `healthy` before
using the vault.

## Environment variables

The image reads these variables:

| variable | default | meaning |
| --- | --- | --- |
| `MEMEV_ROOT` | `/vault` | where the vault lives; the mounted volume |
| `MEMEV_PORT` | `7787` in the image | the port the daemon listens on inside the container; `compose.yaml` publishes the same port on loopback and the health check probes it |
| `MEMEV_CONFIG_DIR` | `/vault/.memev/user-config` in the image | the config folder: the signing key, the licence, the trial record and the device key; in the volume, inside `.memev/`, which the vault's git ignores |
| `MEMEV_BIND` | `0.0.0.0` in the image | the address the daemon binds; keep the compose publish on loopback |
| `MEMEV_TRUST_GATEWAY` | `1` in the image | trust the bridge gateway (the host) as the one local peer |
| `MEMEV_GATEWAY` | the default route | the gateway address, when `MEMEV_TRUST_GATEWAY` is set |
| `MEMEV_NO_TUNNEL` | `1` in the image | no tunnel from inside the container; run it on the host |
| `MEMEV_NO_SERVICE` | `1` in the image | no login service or app registration inside the container |
| `MEMEV_CONTAINER` | `1` in the image | the container entry point: create the vault on first run and run the container doctor checks |
| `MEMEV_VERSION` | the package version | the `org.opencontainers.image.version` label on the image |
| `MEMEV_IMAGE` | `memev:local` | the image name `compose.yaml` uses; set it to a published image to run that instead of a local build |

## Pull and run

The image is not published to a registry yet. Publishing a versioned image needs the registry
decision (D-SO-REGISTRY) and the owner's go (D-01); this repository publishes nothing. Until the
registry is decided, the image name below is a placeholder:

```sh
docker pull registry.example/memev:0.1.0
docker run -d --name memev -p 127.0.0.1:7787:7787 -v memev-vault:/vault registry.example/memev:0.1.0
```

With a local build, `docker compose up -d` does the same: it builds the image, starts it on
`127.0.0.1:7787` and mounts the `memev-vault` volume.

## Upgrades

Pull the new tag and start it; the volume keeps the vault, so the new image reads the existing
data:

```sh
docker compose pull
docker compose up -d
```

`docker compose up -d` recreates the container when the image changed and leaves the volume
untouched. Check the state with `docker compose ps` and wait for the health check to pass.

## Safe shutdown

`docker compose down` stops the container and keeps the volume. Stopping sends SIGTERM to the
daemon; it flushes the op-log, closes the listener and exits 0 within 10 seconds, the grace period
`docker stop` waits by default. If the daemon does not exit in time, `docker stop` escalates to
SIGKILL and the volume still keeps everything that was flushed.

`memev selftest` inside the image checks a throwaway vault end to end; `scripts/docker-smoke.sh`
runs the full container check against whatever image `MEMEV_IMAGE` names, or a local build when it
is not set. It runs in a compose project of its own, `memev-smoke`, so a memev deployed from the
same checkout keeps its container and its volume, and it removes the `memev-smoke` volume at the
end. If a memev on the machine already publishes port 7787, run the smoke with `MEMEV_PORT` set to a
free port.

## Trial setup

The trial is free and runs on your own machine. The convergence engine is a separate component under its own licence and is not part of the image. The image is not published to a registry yet; build it locally with `docker compose -f compose.trial.yaml build`.

Three steps to a running trial:

1. Get the compose file. Copy `compose.trial.yaml` from the repository, or set `MEMEV_IMAGE` to a prebuilt image name.
2. Start it. Run `docker compose -f compose.trial.yaml up -d`. The port is published on `127.0.0.1:7787` only. Wait for the health check to pass: `docker compose -f compose.trial.yaml ps` shows `healthy`.
3. Copy the licence into the volume and install it. Copy the signed licence file into the container with `docker compose -f compose.trial.yaml cp trial.license.json memev:/vault/trial.license.json`, then run `docker compose -f compose.trial.yaml exec memev memev license install /vault/trial.license.json`. The licence file is a signed JSON document; the free tier needs no licence, but installing one records the trial.

Expected output for each step:

Step 1: the file `compose.trial.yaml` is in the repository root.

Step 2: `docker compose -f compose.trial.yaml up -d` prints `Container memev-1 Started`. `docker compose -f compose.trial.yaml ps` prints `memev-1  Up  healthy`.

Step 3: `docker compose -f compose.trial.yaml cp trial.license.json memev:/vault/trial.license.json` copies the file into the volume. `docker compose -f compose.trial.yaml exec memev memev license install /vault/trial.license.json` prints `installed licence <lid> (<state>) in <path>`.

`scripts/docker-trial-smoke.sh` runs the whole path on a machine with Docker: build, up, wait for healthy, doctor, licence install of a throwaway test licence, down with volumes removed. It runs as its own compose project, `memev-trial-smoke`, so the volumes it removes are its own and a memev deployed from the same folder keeps its container and its vault. Run it by hand, not in CI.
