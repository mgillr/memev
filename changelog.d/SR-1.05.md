### Security

- The rate limiter holds at most 10,000 buckets. A bucket idle for two minutes is dropped, and at the bound a bucket that has used up its limit is the last to go, so a flood of new callers cannot free a caller over its own limit.
- A caller is now counted by its socket address, or by `cf-connecting-ip` only through a running Cloudflare tunnel, on its loopback peer, since Cloudflare overwrites that header. `x-forwarded-for` no longer counts, and rotating either header no longer escapes the limit.
- A request with a valid token is counted by that token alone, and any other request by its address. Behind a relay, Tailscale or a reverse proxy, all callers arrive from one address: requests with no valid token, and the OAuth and invite routes, share one bucket there, which a stranger can use up, while each valid token keeps its own bucket and is not affected.
