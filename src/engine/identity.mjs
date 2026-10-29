// SPDX-License-Identifier: Apache-2.0
// Identity for the Business trial: who is running this, and whether they stand for a business.
// A trial is for a business, so it installs only on a business-class identity, and that identity
// stays separate from a personal one. This module is pure and names no person, machine or domain:
// it classifies identities, checks a vault for an organisation, and enforces the separation and
// abuse guards around the trial. The issuer that mints a trial runs outside this repository.

/** The Business trial's defaults (docs/BUSINESS-TRIAL-ISSUING.md). A trial is a configurable cap on
 * members and computers; these are the defaults for the self-serve Business trial. */
export const TRIAL_DEFAULTS = {
  members: 5,
  computers: 10,
  days: 14,
  extensions: 1,
  extension_days: 14,
};

const DAY = 86400e3;

/**
 * An identity is an object. A business-class identity stands for an organisation (it is marked
 * business, or it names one); a personal identity stands for one person. A bare string, or an
 * object with neither mark, is personal.
 */
export function classifyIdentity(id) {
  if (id && typeof id === 'object' && !Array.isArray(id)) {
    if (id.kind === 'business' || id.kind === 'organisation' || id.organisation) return 'business';
    return 'personal';
  }
  return 'personal';
}

export const isBusinessIdentity = (id) => classifyIdentity(id) === 'business';
export const isPersonalIdentity = (id) => classifyIdentity(id) === 'personal';

/** A vault has an organisation when its config marks an organisation install. */
export function vaultHasOrganisation(vault) {
  return !!(vault && typeof vault === 'object' && (vault.profile === 'org' || vault.organisation));
}

/** The tier ids that stand for a business (a company, not one person). */
const BUSINESS_TIERS = new Set(['business', 'corporate', 'team', 'office', 'enterprise']);
export const isBusinessTier = (tier) => BUSINESS_TIERS.has(tier);

/**
 * A trial licence is a business-class licence with the trial's shape: the trial's computer cap and
 * a term of the trial's length. A longer business licence or a personal licence is not a trial.
 */
export function isTrialLicense(license) {
  if (!license || typeof license !== 'object') return false;
  if (!isBusinessTier(license.tier)) return false;
  if (license.seats !== TRIAL_DEFAULTS.computers) return false;
  const iat = Date.parse(license.iat); const exp = Date.parse(license.exp);
  if (Number.isNaN(iat) || Number.isNaN(exp)) return false;
  return Math.round((exp - iat) / DAY) === TRIAL_DEFAULTS.days;
}

/** The identity a vault's config implies: an organisation install is a business identity, the rest personal. */
export function identityFromConfig(cfg) {
  return vaultHasOrganisation(cfg) ? { kind: 'business', organisation: true } : { kind: 'personal' };
}

/**
 * A trial licence installs only on a business-class identity, and only into a vault that has an
 * organisation. On a personal identity or a personal vault the install is refused with a reason.
 * A licence that is not a trial is not guarded here.
 */
export function installGuard({ license, identity, vault } = {}) {
  if (!isTrialLicense(license)) return { ok: true, reason: null };
  if (isPersonalIdentity(identity)) return { ok: false, reason: 'a trial licence installs only on a business identity; this is a personal identity' };
  if (!vaultHasOrganisation(vault)) return { ok: false, reason: 'a trial licence installs only into a vault with an organisation; this vault has none' };
  return { ok: true, reason: null };
}

/**
 * Separation: with a trial installed, a join, mount or release from a personal identity, and a mount
 * of a personal vault, are refused. Personal and business stay fully separate; a trial adds no
 * exception. `action` is one of join, mount, release.
 */
const SEPARATION_ACTIONS = new Set(['join', 'mount', 'release']);
export function separationGuard({ action, identity, vault, trial = false } = {}) {
  if (!trial) return { ok: true, reason: null };
  if (!SEPARATION_ACTIONS.has(action)) return { ok: true, reason: null };
  if (isPersonalIdentity(identity)) return { ok: false, reason: `with a trial installed, a ${action} from a personal identity is refused; personal and business stay separate` };
  if (action === 'mount' && !vaultHasOrganisation(vault)) return { ok: false, reason: 'with a trial installed, mounting a personal vault is refused; personal and business stay separate' };
  return { ok: true, reason: null };
}

/**
 * Members enter only through an organisation admin's invite into the company vault. A member invite
 * on a vault with no organisation is refused, and redeeming one from a personal identity is
 * refused. A refused invite counts toward nothing.
 */
export function memberInviteGuard({ vault, identity } = {}) {
  if (!vaultHasOrganisation(vault)) return { ok: false, reason: 'a member invite needs a vault with an organisation; this vault has none', counts: false };
  if (isPersonalIdentity(identity)) return { ok: false, reason: 'a member invite is redeemed by a business identity; this is a personal identity', counts: false };
  return { ok: true, reason: null, counts: true };
}

/**
 * Offboarding behaves identically with a trial licence: revocation, wipe, the no-export rule, the
 * audit and seat release have no trial exception. The result depends only on who and what is being
 * offboarded, never on whether a trial is present.
 */
export function offboard({ license = null, trial = false, members = 0, computers = 0 } = {}) {
  void license; void trial; // a trial changes nothing here
  return {
    revoked: true,
    wiped: true,
    export: 'refused',
    audit: 'kept',
    seats_released: computers,
    members_released: members,
  };
}
