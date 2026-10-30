### Added

- `docs/SECURITY-BRIEF.md` is the customer security brief: where the notes live, what leaves the computer, how a credential is scoped and revoked, what the threat model covers and leaves out, and what is built against what is planned, each answer linked to the page that holds the detail.
- `docs/DATA-FLOW.md` is the one-page data-flow map: every outbound call a default install can make (the licence activation, the backup to your own remote, the secure link you switch on) and nothing else, agreeing with the threat model and the metrics page, which state no telemetry and only licence information plus the opt-in milestone report.
- `docs/PILOT-CHECKLIST.md` is the two to four week remote pilot checklist: a named step and an owner per week, agreeing week for week with the setup table in `docs/tiers/business.md`, linking the services menu for anything quoted, and marking every planned part as planned.
- `docs/README.md` lists the three pages, and `test/sales-kit.test.mjs` fails if a page is missing, loses an answer or a link, adds or misses an outbound call, drifts from the Business setup table, or claims approval by an outside body.
