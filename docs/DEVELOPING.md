# Developing Memev

Part of the [Memev documentation](README.md). Up: the [README](../README.md#for-developers). Related:
[ARCHITECTURE.md](ARCHITECTURE.md), [MODULES.md](MODULES.md), [RELEASING.md](RELEASING.md).

Memev needs Node 22 or newer and git. It has no runtime dependencies and no lockfile, so there is
nothing to install.

## Checks to run before you open a pull request

```sh
npm test                                   # node --test over test/*.test.mjs, four files at a time
node scripts/leak-scan.mjs --history       # denylisted words, e-mail addresses, IPs and home paths, in files and every commit message
node scripts/changelog-assemble.mjs --check   # every note in changelog.d/ parses
node scripts/docs/module-graph.mjs --check    # docs/MODULES.md matches the real imports
```

CI runs the tests, the changelog guard and the leak scan on every pull request, and gitleaks on the
history. The Windows job runs a subset on a push to `main`. See `.github/workflows/ci.yml`.

## Changelog notes

A change adds one note, `changelog.d/<CONTRACT-ID>.md`, and never edits `CHANGELOG.md`. At a release
`node scripts/changelog-assemble.mjs` folds the notes in. The format is in
[changelog.d/README.md](../changelog.d/README.md).

## Docs that are checked

- `test/docs-links.test.mjs` fails on a broken relative link or anchor in any Markdown page, and on a
  page under `docs/` that [README.md](README.md) does not list.
- `test/docs-module-map.test.mjs` fails when [MODULES.md](MODULES.md) is out of date. Regenerate it
  with `node scripts/docs/module-graph.mjs` after a change to what imports what.
- `test/pricing-docs.test.mjs` and `test/pricing-honesty.test.mjs` hold the price figures and the rule
  that nothing planned is sold as built ([tiers/README.md](tiers/README.md#what-is-built-and-what-is-planned)).
- `test/licence-wording.test.mjs` keeps wording that tells people how to avoid the computer limit out of the docs.

## Other scripts

| Script | What it does |
|---|---|
| `npm run bench` (`scripts/bench/run.mjs`) | the recall benchmark, see [BENCH.md](BENCH.md) |
| `scripts/growth-bench.mjs` | the 170-million-token growth run behind the figures in [DESIGN.md](DESIGN.md) |
| `scripts/docker-smoke.sh` | builds the image and runs a check inside it, see [DOCKER.md](DOCKER.md) |
| `scripts/release-tarball.mjs` | the release tarball and its checksum, see [RELEASING.md](RELEASING.md) |
| `scripts/license-dev.mjs` | a throwaway key pair that signs test licences; memev does not trust them outside tests |
| `scripts/license/issue.mjs` | issues a real licence; it needs the vendor private key, which is never in this repository |
| `scripts/lab/` | helpers for the [lab test plan](testing/LAB-TEST-PLAN.md) |

## Signed files

Files under `contracts/signed/` have a signature next to them. Do not edit them; a change is a new
signed amendment ([CONTRACTS.md](CONTRACTS.md)).
