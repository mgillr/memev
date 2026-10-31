# Amendments to these contracts after their red-team rounds

## Requirements replaced after a red-team round

A requirement is replaced, never silently removed, only when a round's answer names it as contradictory or impossible; the next round judges the replacement.

- QL-1.03 T1: requirement replaced after red-team round 2 answer 1 (a commit sha cannot be named on main after a squash or a rebase merge, so the run on main would be red after every sensitive squash or the binding would be loosened until a copied checklist passes). From: "the head being checked is the newest non-merge commit in base..HEAD whose diff touches a sensitive path (renames followed, deletions counted); the checklist file is named after that commit (security/checklists/<its sha, 12 characters>.md) and its Head line names that commit; commits after it may touch only security/checklists/ and non-sensitive files, otherwise the binding is stale; the gate therefore works on a pull request merge ref and after a squash, where no author knows the final sha". To: "the checklist is bound to content, not to a commit: the gate computes the sensitive diff id, the sha256 over the sorted lines '<path> <blob id at the head>' (or '<path> deleted') of every sensitive pa ...".
