# Quality-loop gate contracts

Keep building with contracts, and have different eyes check on a schedule against a fixed rubric; every finding becomes a contract. The owner ordered the principles below implemented as a gate for all development on 30 October 2026.

1. Red-team each contract before it is signed: a fresh agent with no build context reads only the spec and the code it covers and answers how the contract could pass while the feature is broken or unsafe; each answer becomes a stronger criterion; nothing is signed until a round comes back clean.
2. A code task needs a test that fails before the change and passes after it; grep and file-exists checks are secondary; mutation testing breaks the changed lines on purpose; document checks never count toward done.
3. A weekly independent audit with a fixed rubric (product, paid product, moat, timing, go-to-market, team, legal), its findings in the gap register, the escape rate and the overall score tracked.
4. A claims ledger in every repository; CI fails where a claim runs ahead of its row.
5. Planned items age out: a warning after four weeks without a date, a decision after eight.
6. Weekly checks against reality: a clean-machine install, the growth benchmark on named hardware, one lab-plan area, one observed user session.
7. A security checklist before merge on changes to command execution, auth, tokens, the tunnel or the oplog.
8. A second human on main once SR-9.05 lands.

| Contract | Repository | Title | Depends on |
|---|---|---|---|
| [QL-1.01](specs/QL-1.01-red-team-gate-no-signing.json) | memev | Red-team gate: no contract is signed without a clean record that matches its spec | none |
| [QL-1.02](specs/QL-1.02-mutation-gate-on-changed-lines.json) | memev | Mutation gate: the changed lines are broken on purpose and the tests must catch every mutant | SR-0.03 |
| [QL-1.03](specs/QL-1.03-sensitive-path-checklist-before-merge.json) | memev | Security checklist before merge on every change that touches command execution, auth, tokens, the tunnel or the oplog | none |
| [QL-1.04](specs/QL-1.04-claims-ledger-check-in-every-repository.json) | memev | The claims check runs in every repository from one script: a claim ahead of its status row fails CI | SR-5.04 |
