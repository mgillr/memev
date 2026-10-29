# Issuing the Business trial

The Business trial is a short, capped trial of the Business tier. It is issued by the licence
issuer, which runs outside this repository. This page states the rules the issuer follows and the
size of the self-serve trial. The numbers here are the defaults in `TRIAL_DEFAULTS` in
`src/engine/identity.mjs`.

## One trial per organisation

- One trial per verified work domain, and one per organisation id. The two are checked together, so
  a company cannot take a second trial under a second domain or a second id.
- The work domain is kept only as a hash. The issuer stores the hash, not the domain, so a domain
  cannot be read back out of the issuer's records.
- Consumer mail domains are refused. A trial needs a work domain, so a domain that is a consumer
  mail provider does not qualify.
- A second trial is only by the owner's exception. There is no self-serve path to a second trial.

## Size of the self-serve trial

A trial is a configurable cap on members and computers. The self-serve Business trial defaults to
5 members and 10 computers, for 14 days, with one 14-day extension.

- Members: 5
- Computers: 10
- Term: 14 days
- Extension: one, for 14 days

The caps are configurable at the issuer; the numbers above are the defaults. A trial is a business
licence with this shape, and it installs only on a business-class identity, into a vault with an
organisation.

## The sales-assisted pilot

A pilot that sales assists is sized by the order form, not by the self-serve defaults above. The
licence is issued on the day of install, so the term starts at install, and an extension goes
through the sales-assisted lane rather than the self-serve one.

## The extension rule

An extension is once per organisation. It is self-serve on request, and the issuer checks a
verified work contact before it grants one.
