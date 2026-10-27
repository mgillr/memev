// SPDX-License-Identifier: Apache-2.0
// What each tier includes. REPORT ONLY: nothing in Memev is gated on this today, and can() answers
// with free-tier behaviour whatever licence is installed. The Charter (CHARTER.md) applies: the
// free tier is never limited. Everything on one computer works the same with or without a licence.

/** Switched off. When paid hosted services exist they check entitlement on their own servers. */
export const ENFORCEMENT = 'off';

/** Everything local is free and unlimited, for everyone. */
export const CORE_FEATURES = ['vault', 'recall', 'graph', 'contracts', 'doctor', 'local_clients', 'own_tunnel', 'git_backup', 'cloud_connectors'];
/** Paid add-ons: hosted services and multi-computer or team use. None of them exists yet. */
export const PAID_FEATURES = ['sync_hosted', 'backup_hosted', 'relay_hosted', 'extra_computers', 'team_vault', 'sso', 'audit_export'];

/** Draft limits per tier (docs/PRICING.md). null = no limit or set by contract. Used for reports only. */
export const TIERS = {
  free: { computers: 1, connectors: 5, local_clients: null, services: [] },
  personal: { computers: 4, connectors: 10, local_clients: null, services: ['sync', 'backup', 'relay'] },
  team: { computers: null, connectors: null, local_clients: null, services: ['sync', 'backup', 'relay', 'team'] },
  office: { computers: null, connectors: null, local_clients: null, services: ['sync', 'backup', 'relay', 'team'] },
  enterprise: { computers: null, connectors: null, local_clients: null, services: ['sync', 'backup', 'relay', 'team', 'sso', 'audit'] },
};

/** Free-tier behaviour, always: core features yes, paid hosted features no (they do not exist yet). */
export function can(feature) {
  if (CORE_FEATURES.includes(feature)) return true;
  if (PAID_FEATURES.includes(feature)) return false;
  throw new Error(`unknown feature: ${feature}`);
}

/** The limits a licence would give (seats and connectors override the tier defaults). */
export function limitsFor(lic) {
  if (!lic || !['valid', 'grace'].includes(lic.state)) return { tier: 'free', ...TIERS.free };
  const base = TIERS[lic.tier] || TIERS.personal;
  return { tier: lic.tier, computers: lic.seats ?? base.computers, connectors: lic.connectors ?? base.connectors, local_clients: null, services: lic.services || base.services };
}

/**
 * Compare what is in use with what the tier covers. Returns notes for the user, never a decision:
 * `blocked` is always false.
 */
export function report({ license = null, seats }) {
  const limits = limitsFor(license);
  const notes = [];
  if (limits.computers !== null && seats.computers > limits.computers) notes.push(`${seats.computers} computers use this vault; the ${limits.tier} tier covers ${limits.computers}. Nothing is limited: this is a report only.`);
  if (limits.connectors !== null && seats.connectors > limits.connectors) notes.push(`${seats.connectors} cloud AI connectors are active; the ${limits.tier} tier covers ${limits.connectors}. Nothing is limited: this is a report only.`);
  return { enforcement: ENFORCEMENT, effective_tier: 'free', licensed_tier: limits.tier, limits, usage: seats, notes, blocked: false };
}
