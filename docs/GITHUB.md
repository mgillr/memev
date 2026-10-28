# GitHub backup

```sh
memev github setup                 # or: memev github setup --repo you/my-memory
memev github setup --host ghe.example.com   # GitHub Enterprise
memev backup set <git-url>         # any private git remote (self-hosted, file, etc.)
```

1. Signs you in to the GitHub CLI if needed (`gh auth login`, browser device code). Memev never sees
   your password or keeps your GitHub token.
2. Creates a **private** repository (default name `memev-vault`) or uses the one you name. A public
   repository is refused.
3. Creates an SSH key for this vault only and adds it to that repository as a deploy key with write
   access. The key can push to that one repository and nothing else.
4. Points the vault's git remote at it, adds a pre-push check that refuses to push to any other
   remote, and pushes.

After that the daemon pushes every few minutes when there are new commits. `memev github status`
shows the target; `memev doctor` reports failed pushes.

## When port 22 is blocked

Some networks (corporate firewalls, some mobile networks) block outbound port 22. When a fetch or
push over port 22 fails, Memev retries the same operation through `ssh.github.com` on port 443,
which carries the same SSH session over a port most networks leave open. `memev doctor` checks
that at least one of the two paths is reachable and says which one answers.

If both are blocked, push over HTTPS with a fine-grained token instead:

1. In GitHub, create a fine-grained token with **Contents: read and write** on this one
   repository only.
2. Point the vault at it:
   `git remote set-url origin https://x-access-token:<token>@github.com/you/my-memory`
3. Update the pre-push check in `.git/hooks/pre-push` so `expected=` is the new URL (the check
   refuses to push anywhere else).

The token lives in the vault's git config on this machine only; it is never committed.

To stop: delete the deploy key in the repository settings and run `git remote remove origin` in the
vault.
