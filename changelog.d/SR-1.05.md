### Security

- The rate limiter holds at most 10,000 buckets. A bucket idle for two minutes is dropped, and at the bound a bucket that has used up its limit is the last to go, so a flood of new callers cannot free a caller over its own limit.
