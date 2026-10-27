# Docker

```sh
docker compose up -d
docker compose exec memev memev token issue my-app
```

`compose.yaml` publishes port 7787 on the host's loopback only (`127.0.0.1:7787`) and keeps the
vault in the `memev-vault` volume. The image runs as the unprivileged `memev` user and has a health
check on `/healthz`.

Point an app at `http://127.0.0.1:7787/mcp` with `Authorization: Bearer <token>`.

Inside the container the tunnel, the login service and app registration are off: the container
cannot see your apps or your login session. For cloud access, run the tunnel on the host
(`cloudflared tunnel --url http://127.0.0.1:7787`) and use a token issued with `--remote`.

`memev selftest` inside the image checks a throwaway vault end to end; `scripts/docker-smoke.sh` runs the full container check.
