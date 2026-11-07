### Security

- The rate limiter holds at most 10,000 buckets. A bucket idle for two minutes is dropped, and at the bound a bucket that has used up its limit is the last to go, so a flood of new callers cannot free a caller over its own limit.
- A caller is now counted by its socket address, or by `cf-connecting-ip` only through a running Cloudflare tunnel, on its loopback peer, since Cloudflare overwrites that header. `x-forwarded-for` no longer counts, and rotating either header no longer escapes the limit. Today everyone through a relay, Tailscale or a reverse proxy shares one address and one bucket.
