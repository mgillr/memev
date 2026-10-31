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
- A copy's history now ends at the base: its HEAD is the base and the change is uncommitted work in it, so no ref, reflog
  entry or object in a copy holds a changed file's new text. A copy keeps the caller's settings but no remote, URL
  rewrite, credential helper or HTTP header.
- Every command the gate runs has git's credential helpers off and sees no GIT_CONFIG_GLOBAL, GIT_CONFIG_PARAMETERS or
  GIT_CONFIG_COUNT settings from the caller, and every test command finds the gate's own refusing stubs for launchctl,
  systemctl, schtasks and cloudflared first on its PATH.
- A changed file under a -diff or binary attribute is read as text, so its lines are judged under their real path; a
  changed file whose diff still shows no lines is listed under `unjudged`.
- The rewrite control writes an operand X as (N, X), with N a number chosen per run, so deleting parentheses, spaces and
  comments never restores a line; a statement that opens with a name, this or a prefix ++ or -- takes the same form whole.
  `--json` lists each mutant that timed out under `timeouts`.
