# Receipts for k-sr-1-35-memev-is-fast-on-27f507

Every verification of the signed contract, newest last.

### 2026-11-07T18:06:03.856Z · verify · PASS · 7/7 tasks
- PASS T1 Start, first run and stop (A1, A7, A8)
  - PASS T1-AC01 T1-c00: the full suite passes (on CI, never on the Mac) (exit 0)
  - PASS T1-AC02 T1-c01: 2 tests in test/notestate.test.mjs failed on main's code by assertion and pass here: "where the changed time cannot help, the start misses the edit and the sweep finds it, with the time it took"; "memev start leaves a daemon that says it is loading, and stops one that says nothing" (red exit 1, green exit 0, base 93d97329a9257c6e4d03a1f1ff4650abd998845c)
  - PASS T1-AC03 T1-c01w: Notes changed while stopped are found, the restored graph equals a full read, and a hard kill during the first import loses nothing: test/notestate.test.mjs passes whole; 6 of its tests also pass on main's code, so they guard behaviour and claim no change; 10 more fail there by another error or run past two minutes, and claim no red (exit 0)
  - PASS T1-AC04 T1-c02: 3 tests in test/oplog-sliced-snapshot.test.mjs failed on main's code by assertion and pass here: "the append that reaches the snapshot count returns before the snapshot is written"; "writes during the snapshot: the reopened log has the same heads as a full replay, and a broken replay is caught"; "a stop during a running snapshot: the close snapshot stands or the older one replays, and both give the same heads" (red exit 1, green exit 0, base 93d97329a9257c6e4d03a1f1ff4650abd998845c)
  - PASS T1-AC05 T1-c02w: A log snapshot no longer stops the thread that serves: test/oplog-sliced-snapshot.test.mjs passes whole; 1 of its tests also passes on main's code, so it guards behaviour and claims no change; 1 more fails there by another error or runs past two minutes, and claims no red (exit 0)
  - PASS T1-AC06 Changes stay in scope (87 changed files, all inside the scope)
- PASS T2 Save and recall (A2, A3), and damage to the index
  - PASS T2-AC01 T2-c01w: The segment index answers as the old one did: test/segment-index.test.mjs passes whole, and it could not load on main's code, so no red run is claimed for it (exit 0)
  - PASS T2-AC02 T2-c02: an index cut in half is noticed: on main's code the words are lost and nothing says so (red exit 1, green exit 0, base 93d97329a9257c6e4d03a1f1ff4650abd998845c)
  - PASS T2-AC03 T2-c03w: Damage is found, named and rebuilt, and no status field shows a limited token a path outside its scope: test/index-damage.test.mjs passes whole, and it could not load on main's code, so no red run is claimed for it (exit 0)
  - PASS T2-AC04 Changes stay in scope (87 changed files, all inside the scope)
- PASS T3 Write and git (A4, A5)
  - PASS T3-AC01 T3-c01: 3 tests in test/commit-queue-thread.test.mjs failed on main's code by assertion and pass here: "a timed commit leaves this thread free: it keeps turning while the batch runs"; "a note written and deleted inside one quiet period does not stop every later commit"; "a hard kill loses no acknowledged write, and the reopened vault commits what the kill left uncommitted" (red exit 1, green exit 0, base 93d97329a9257c6e4d03a1f1ff4650abd998845c)
  - PASS T3-AC02 T3-c01w: A commit leaves the thread free and every acknowledged write is committed, after a hard kill too: test/commit-queue-thread.test.mjs passes whole; 1 of its tests also passes on main's code, so it guards behaviour and claims no change; 7 more fail there by another error or run past two minutes, and claim no red (exit 0)
  - PASS T3-AC03 T3-c02: 1 test in test/vault-case-names.test.mjs failed on main's code by assertion and passes here: "a new note does not read every live head once the first new note has been checked" (red exit 1, green exit 0, base 93d97329a9257c6e4d03a1f1ff4650abd998845c)
  - PASS T3-AC04 T3-c02w: A new note does not read every live head, and the check for a name that differs only in letter case answers as the old one did: test/vault-case-names.test.mjs passes whole; 2 of its tests also pass on main's code, so they guard behaviour and claim no change (exit 0)
  - PASS T3-AC05 Changes stay in scope (87 changed files, all inside the scope)
- PASS T4 The bus (A6)
  - PASS T4-AC01 T4-c01: SR-1.17: 50 seats and 100,000 messages, roster under 50 ms. On main's code this one test fails by assertion in about 41 s; the file then does not end on main's code, so it alone claims a red (red exit 1, green exit 0, base 93d97329a9257c6e4d03a1f1ff4650abd998845c)
  - PASS T4-AC02 T4-c01w: test/bus-scale.test.mjs passes whole, and the bus answers as before (exit 0)
  - PASS T4-AC03 T4-c02w: Files roll over with nothing lost, and the limit is stated: test/bus-rotation.test.mjs passes whole, and it could not load on main's code, so no red run is claimed for it (exit 0)
  - PASS T4-AC04 T4-c03w: test/bus-oracle.test.mjs passes whole: every answer matches the old bus on random histories. On main's code that promise passes, as it must, and only its mutation controls fail, because the code they break is not there, so no red run is claimed (exit 0)
  - PASS T4-AC05 Changes stay in scope (87 changed files, all inside the scope)
- PASS T5 Three findings on the same path
  - PASS T5-AC01 T5-c01: 8 tests in test/speed-promises.test.mjs failed on main's code by assertion and pass here: "the prompt hook leaves past journals out before ranking, so a prompt asked before still gets its memory"; "a note added or edited while stopped reaches recall at the next start"; "a write just before a hard kill reaches recall at the next start"; "a write before a hard kill reaches recall even when the vault has never stopped cleanly"; "an old index converts once: same answers, the old file goes, and a kill before the end starts over"; "after a downgrade and an upgrade again, the index the older version kept is the one converted, and a journal it archived stays out"; "a note the old index never saw reaches recall through the conversion, as a hard kill before the upgrade leaves it"; "status says a daemon is loading rather than not running" (red exit 1, green exit 0, base 93d97329a9257c6e4d03a1f1ff4650abd998845c)
  - PASS T5-AC02 T5-c01w: The hook filter, stopped changes and hard kills reach recall: test/speed-promises.test.mjs passes whole; 2 of its tests also pass on main's code, so they guard behaviour and claim no change; 1 more fails there by another error or runs past two minutes, and claims no red (exit 0)
  - PASS T5-AC03 Changes stay in scope (87 changed files, all inside the scope)
- PASS T6 A ceiling on every axis, and results on the repository
  - PASS T6-AC01 T6-c00: the ceilings command exists on this code and did not on main's (red exit 1, green exit 0, base 93d97329a9257c6e4d03a1f1ff4650abd998845c)
  - PASS T6-AC02 T6-c01: the ceilings can fail, a number that does not come back fails, and old code must fail those meant to catch it (exit 0)
  - PASS T6-AC03 T6-c02: every ceiling holds at 50,000 generated notes (exit 0)
  - PASS T6-AC04 T6-c03: on the contract's base, the same benches fail every ceiling in CAUGHT (exit 0)
  - PASS T6-AC05 T6-c04: the results name a commit that is in this history, and say what was not measured (exit 0)
  - PASS T6-AC06 Changes stay in scope (87 changed files, all inside the scope)
- PASS T7 Health data for the app
  - PASS T7-AC01 T7-c01: the daemon reports what it measured, in memev status --json, and says what it did not; this failed on main's code by assertion (red exit 1, green exit 0, base 93d97329a9257c6e4d03a1f1ff4650abd998845c)
  - PASS T7-AC02 Changes stay in scope (87 changed files, all inside the scope)
