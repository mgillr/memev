### Added

- `node scripts/gate/mutate.mjs --base <sha> --test <cmd>` breaks each line added or changed since `<sha>` under `src/`,
  `vendor/` and `bin/` one mutant at a time and fails when the tests still pass on one. It runs the unmutated tests twice
  and once with the changed lines rewritten to the same meaning before judging, judges each mutant on two runs in a
  self-contained copy with a fresh home, and runs the unmutated tests again before it accepts a kill; any failing control
  stops the run as noise. `--json` reports the counts, the survivors and the lines that produced no mutant.
