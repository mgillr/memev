# The Business trial

Part of the [Memev documentation](README.md). Up: the [README](../README.md). Related:
[PRICING.md](PRICING.md), [LICENSING-NOTICE.md](LICENSING-NOTICE.md), [tiers/business.md](tiers/business.md).

> **DRAFT.** The trial terms below are decided. Both delivery paths are planned, with no date, and
> nothing here is an offer. There is no Personal trial; Personal is free on one computer and priced
> on the next ones.

The Business trial is a time-limited entitlement to evaluate the planned Business deployment within
an agreed scope. The architecture is provider-neutral: participants may use the hosted AI providers,
local models and agent tools permitted by their organisation. The trial is free: it costs nothing,
and it is not a discount on a later subscription. The exact topology and data scopes must be agreed
for the pilot; this draft does not assume one central company vault.

## Length and size

The trial runs **14 days** and can be extended **once by 14 days**, on request, for a total of
**28 days**. There is no second extension.

The trial size comes from the licence and defaults to **5 members and 10 computers**. A larger
trial is not self-serve: an organisation that needs more members or computers gets a sales-assisted
pilot, sized from the order form.

## The two paths

**Self-serve Business trial (planned).** For a team using hosted AI providers, local models or a
mix of AI tools and local agents, within the trial's supported deployment scope. It suits a
cloud-hosted deployment where the server runs on a host the operator manages (planned). Deployment: [deploy-cloud.md](deploy-cloud.md). The setup session page
(docs/SETUP-SESSION.md) and the cloud trial page (docs/CLOUD-TRIAL.md) are planned and will carry
the step-by-step.

**Sales-assisted pilot (planned).** For an organisation with an internal model, an air-gapped
install or a compliance-led rollout. It suits on-prem: the server runs inside your network, the
size comes from the order form, and the term starts when the licence is installed. Deployment:
[deploy-on-prem.md](deploy-on-prem.md).

Either way you can also install the company server on your own machine with the container image:
[DOCKER.md](DOCKER.md).

## What the trial costs

- The trial entitlement is free, on both paths.
- The cloud-hosted trial is free and provisioned self-serve.
- Installing on your own servers with the container image is free.
- Setup done by the operator on-prem is a paid service, quoted per [tiers/services.md](tiers/services.md),
  with no amount stated here.
- The full merge engine is on for the trial, once the merge is built (planned): there is no
  reduced-merge mode for a trial vault. The convergence engine is a separately licensed component
  in its own repository, called by Memev as an external dependency; see
  [LICENSING-NOTICE.md](LICENSING-NOTICE.md).

## What happens at the end, in order

1. A grace period keeps everything working, as for any lapsed licence.
2. Then the merge is off (planned): the convergence engine stops merging edits across computers.
3. The added computers become read-only. The vault's own computer keeps reading and writing.
4. Nothing is deleted: the vault and its contents stay where they are.
5. Export always works: the git backup and the export commands run at any time, trial or not.

## The one extension

The extension is planned: you request it once, self-serve, with a verified work contact,
before the first period runs out. It adds one 14-day extension, for 28 days in total, and it is
never granted a second time.

## Converting

To convert, you contact us, receive a Business licence and install it. The vault, the members and
the computers carry over unchanged, and the trial entitlement is replaced by the licence.

## One trial per organisation

One organisation gets one trial. A second trial for the same organisation is not issued: an
organisation that has used its trial converts, or gets a sales-assisted pilot.

## Personal vaults stay separate

A member's personal or home memory remains a separate scope from the organisation's work scope.
They use separate identities and permissions; any explicit sharing requires a deliberate grant and
is governed by the relevant policy.

## What is built and what is planned

Built today for any licence: the grace period, read-only beyond the licensed computers, and
export. The trial licence and its extension are planned.

Planned, as on the [tiers pages](tiers/README.md): the full multi-user business administration,
identity, roles, governed shared scopes, policy enforcement, the automatic merge by the convergence
engine, and both delivery paths of the trial itself. A planned part goes into an
offer only with a delivery date.
