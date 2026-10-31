### Added

- `node scripts/gate/mutate.mjs --base <sha> --test <cmd>` breaks each line added or changed since `<sha>` under `src/`,
  `vendor/` and `bin/` one mutant at a time and fails when the tests still pass on one. It runs the unmutated tests twice
  and once with the changed lines rewritten to the same meaning before judging, judges each mutant on two runs in a
  self-contained copy with a fresh home, and runs the unmutated tests again before it accepts a kill; any failing control
  stops the run as noise. `--json` reports the counts, the survivors and the lines that produced no mutant.
- A changed line that carries code but that no judged mutant covers fails the run: no operator applies to it, each of its
  mutants was invalid or timed out, or its file cannot be read or links outside the repository. `--json` lists it under
  `unjudged` and the run ends with status error. let and var initialisers, strings joined with +, and assignment
  statements with nothing else to mutate on their line now have mutants.
- The rewrite control also rewrites property values, array elements, prefix ++ and --, a bare `return;` and statements
  that open with `this`, and stops the run as noise when a line that carries a mutant cannot be rewritten. No mutant is
  written through a link, and a test that leaves a detached process holding its output no longer stalls the run.
