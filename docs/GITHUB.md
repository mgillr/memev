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

To stop: delete the deploy key in the repository settings and run `git remote remove origin` in the
vault.
