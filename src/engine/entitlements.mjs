// SPDX-License-Identifier: Apache-2.0
// What each tier includes, and the one thing a licence limits: how many computers may use a vault.
// The Charter (CHARTER.md) applies: one person on one computer gets all of Memev with no licence,
// and nothing on that computer is ever capped. A licence only decides how many other computers can
// be added to the vault, and whether those computers may still write after it lapses.
//
// The check runs on the vault's own machine, against a signed file the customer installed, with no
// call home.

/** Computers are counted and capped at the vault. Connectors and local apps are reported only. */
export const ENFORCEMENT = 'computers';

/** Everything local is free and unlimited, for everyone. */
export const CORE_FEATURES = ['vault', 'recall', 'graph', 'contracts', 'doctor', 'local_clients', 'own_tunnel', 'git_backup', 'cloud_connectors'];
/** Paid add-ons: hosted services and multi-computer or team use. Only extra computers exist so far. */
export const PAID_FEATURES = ['sync_hosted', 'backup_hosted', 'relay_hosted', 'extra_computers', 'team_vault', 'sso', 'audit_export'];

/** Draft limits per tier (docs/PRICING.md). A licence's own seats and connectors win. */
export const TIERS = {
  free: { computers: 1, connectors: 5, local_clients: null, services: [] },
  personal: { computers: 3, connectors: 10, local_clients: null, services: ['sync', 'backup', 'relay'] },
  team: { computers: null, connectors: null, local_clients: null, services: ['sync', 'backup', 'relay', 'team'] },
  office: { computers: null, connectors: null, local_clients: null, services: ['sync', 'backup', 'relay', 'team'] },
  business: { computers: null, connectors: null, local_clients: null, services: ['team'] },
  enterprise: { computers: null, connectors: null, local_clients: null, services: ['sync', 'backup', 'relay', 'team', 'sso', 'audit'] },
};

/**
 * The plans and what each adds, for `memev upgrade`, in the four tier names the docs use. The
 * one-computer tier is one computer at a time through your own GitHub. The paid difference is
 * using several computers at once, with automatic merge from a separately licensed engine. The
 * comms bus and multi-app memory are in the one-computer tier and are never shown as paid. The
 * computer and connector numbers are the TIERS values for each plan's tier id, omitted where
 * TIERS is null. The full table, with the prices, is docs/PRICING.md (draft).
 */
/** The count phrase for a TIERS number, empty where TIERS is null. */
const count = (n, w) => (n === null ? '' : `${n} ${w}${n === 1 ? '' : 's'}`);
/** The plan line: the non-empty parts, joined with commas. */
const addsText = (parts) => `${parts.filter(Boolean).join(', ')}.`;

export const PLANS = [
  { name: 'Personal', tier: 'free', adds: addsText([
    TIERS.free.computers === null ? '' : `${count(TIERS.free.computers, 'computer')} at a time through your own GitHub`,
    count(TIERS.free.connectors, 'cloud connector'),
  ]) },
  { name: 'Personal with more computers', tier: 'personal', adds: addsText([
    TIERS.personal.computers === null ? '' : `Up to ${count(TIERS.personal.computers, 'computer')} at once`,
    count(TIERS.personal.connectors, 'cloud connector'),
    'with automatic merge from a separately licensed engine',
  ]) },
  { name: 'Business', tier: 'business', adds: 'Contact us.' },
  { name: 'Corporate', tier: 'enterprise', adds: 'Contact us.' },
];

/** Free-tier behaviour for features: core yes, hosted services no (they do not exist yet). */
export function can(feature) {
  if (CORE_FEATURES.includes(feature)) return true;
  if (PAID_FEATURES.includes(feature)) return false;
  throw new Error(`unknown feature: ${feature}`);
}

const live = (lic) => !!lic && ['valid', 'grace'].includes(lic.state);

/** The limits a licence gives (seats and connectors override the tier defaults). */
export function limitsFor(lic) {
  if (!live(lic)) return { tier: 'free', ...TIERS.free };
  const base = TIERS[lic.tier] || TIERS.personal;
  return { tier: lic.tier, computers: lic.seats ?? base.computers, connectors: lic.connectors ?? base.connectors, local_clients: null, services: lic.services || base.services };
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * Who may join and who may write. `devices` is the registry's list. The vault's own computer always
 * counts as one and is never limited. Other computers:
 *   - may be enrolled while fewer than `seats` computers are enrolled and the licence is valid or in
 *     its grace period;
 *   - may write while the licence is valid or in grace, oldest first, up to the seat count;
 *   - keep read access whatever happens, so nobody loses their data.
 */
export function seatPolicy({ license = null, devices = [] } = {}) {
  const state = license?.state || 'none';
  const remote = devices.filter((d) => d.kind === 'remote-computer' && d.status === 'active').sort((a, b) => String(a.created).localeCompare(String(b.created)));
  const seats = live(license) ? license.seats : 1;
  const enrolled = 1 + remote.length;
  const writable = new Set(live(license) ? remote.slice(0, Math.max(0, seats - 1)).map((d) => d.id) : []);
  let canEnroll = true; let reason = null;
  if (state === 'expired') { canEnroll = false; reason = `The licence for this vault expired on ${license.exp} and its grace period is over. Computers already added can still read, but none can be added. Install a renewed licence (memev license install <file>) or contact us.`; }
  else if (enrolled >= seats) { canEnroll = false; reason = live(license) ? `This vault is licensed for ${plural(seats, 'computer')}. Remove one with \`memev devices remove <id>\` or contact us for more.` : `Free covers this computer. Adding more computers is part of Personal (up to ${TIERS.personal.computers} computers). Run memev upgrade to see plans.`; }
  const notes = [];
  if (state === 'grace') notes.push(`The licence expired on ${license.exp} and is in its grace period. Renew it with \`memev license install <file>\`; after that no computer can be added and added computers can only read.`);
  if (state === 'invalid' || state === 'not_yet_valid') notes.push(`The installed licence is not used: ${license.reason}. This vault counts as the free tier.`);
  const readOnly = remote.filter((d) => !writable.has(d.id));
  if (readOnly.length) notes.push(`${plural(readOnly.length, 'computer')} can read but not write (${readOnly.map((d) => d.label).join(', ')}): ${live(license) ? 'more computers are enrolled than the licence covers' : 'there is no valid licence'}.`);
  return { enforcement: ENFORCEMENT, tier: live(license) ? license.tier : 'free', state, seats, enrolled, can_enroll: canEnroll, reason, writable, read_only: readOnly.map((d) => d.id), notes };
}

/** Why a computer may only read, or null when it may write. */
export function readOnlyReason(policy, device) {
  if (!device || device.kind !== 'remote-computer' || policy.writable.has(device.id)) return null;
  return policy.state === 'expired' ? 'the licence for this vault has expired, so this computer can read but not write; ask the vault admin to renew it'
    : !['valid', 'grace'].includes(policy.state) ? 'this vault has no valid licence for other computers, so this computer can read but not write'
      : `this vault is licensed for ${plural(policy.seats, 'computer')} and this one is over the count, so it can read but not write`;
}

/**
 * Usage against the limits, for `memev license status` and the doctor. Connectors are reported,
 * not capped.
 */
export function report({ license = null, seats, devices = [] }) {
  const limits = limitsFor(license);
  const policy = seatPolicy({ license, devices });
  const notes = [...policy.notes];
  if (limits.connectors !== null && seats.connectors > limits.connectors) notes.push(`${seats.connectors} cloud AI connectors are active; the ${limits.tier} tier covers ${limits.connectors}. Connectors are reported, not limited.`);
  return { enforcement: ENFORCEMENT, effective_tier: policy.tier, licensed_tier: limits.tier, limits, usage: seats, seats_licensed: policy.seats, computers_enrolled: policy.enrolled, can_enroll: policy.can_enroll, enroll_refused: policy.reason, read_only: policy.read_only, notes, blocked: false };
}
