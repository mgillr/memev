# Changelog notes

Every change adds one note here instead of editing CHANGELOG.md, so changes made side by side never
conflict on it.

- Name the note after the contract it delivers: `changelog.d/MEM-010.md`. A change with no contract
  uses a short name of its own.
- Write one or two lines under a Keep a Changelog heading: `### Added`, `### Changed`,
  `### Deprecated`, `### Removed`, `### Fixed` or `### Security`. Each line is a `- ` bullet; indent a
  line that continues one by two spaces.

```markdown
### Added

- `memev ready` waits for each connected app's first session, then for two of them to share a memory.
```

At release, `node scripts/changelog-assemble.mjs` folds every note into CHANGELOG.md under
`## Unreleased`, in its section, and deletes the notes. `--check` shows what it would fold and fails
on a malformed note. The pull request check (`--guard <base>`) fails any other edit of CHANGELOG.md,
unless the change is a release that bumps the version in package.json.
