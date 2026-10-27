# Docker

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
