# GitHub backup

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

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

## Adding a second computer (Free)

On Free the vault lives on one computer at a time, through your own GitHub. To move it to a second
computer, or to start using it on a second computer, back the vault up on the first computer with
`memev github setup`, then on the second computer clone that backup instead of creating a new vault:

```sh
memev init --from <git-url>     # clone the existing backup into the vault folder
```

`--from` uses plain git, so it works with no GitHub CLI installed. It clones the repository into the
vault folder and keeps its history; it does not create a new, empty vault. If the URL is not a Memev
vault backup, init stops and creates nothing.

If you already have a fresh vault on the second computer and run `memev github setup` against a
repository that holds a different vault, Memev will not push over it: it tells you the histories are
unrelated and offers the clone above instead.
