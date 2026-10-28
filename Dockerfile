# Memev in a container. The vault lives in the /vault volume; the port is published on the host's
# loopback only (see compose.yaml). With MEMEV_TRUST_GATEWAY=1 the server trusts only the bridge
# gateway (the host, found from the default route) as local. Remote access from inside the container
# is off: run a tunnel on the host, or add a cloudflared sidecar (docs/DOCKER.md).
FROM node:22-alpine
RUN apk add --no-cache git openssh-client tini \
 && addgroup -S memev && adduser -S -G memev -h /home/memev memev
WORKDIR /opt/memev
COPY package.json LICENSE NOTICE README.md ./
COPY bin ./bin
COPY src ./src
COPY templates ./templates
COPY vendor ./vendor
RUN ln -s /opt/memev/bin/memev.mjs /usr/local/bin/memev && chmod +x /opt/memev/bin/memev.mjs \
 && mkdir -p /vault && chown memev:memev /vault
USER memev
ARG MEMEV_VERSION=0.1.0
LABEL org.opencontainers.image.title="memev" \
  org.opencontainers.image.description="One local memory shared by every AI session you run: an MCP server over a git-backed Markdown vault you own." \
  org.opencontainers.image.licenses="Apache-2.0" \
  org.opencontainers.image.version="${MEMEV_VERSION}"
ENV HOME=/home/memev MEMEV_ROOT=/vault MEMEV_BIND=0.0.0.0 MEMEV_TRUST_GATEWAY=1 MEMEV_NO_TUNNEL=1 MEMEV_NO_SERVICE=1 MEMEV_CONTAINER=1
VOLUME ["/vault"]
EXPOSE 7787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:7787/healthz || exit 1
ENTRYPOINT ["/sbin/tini", "--", "memev"]
CMD ["container"]
