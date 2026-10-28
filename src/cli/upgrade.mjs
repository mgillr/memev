// SPDX-License-Identifier: Apache-2.0
// `memev upgrade` and `memev plan`, shown only when asked: the plans and what each adds, how to
// buy, and the usage of this vault. When the vault's config sets a checkout URL, upgrade prints
// that URL and nothing else. Nothing in this file is a payment provider, a price, a sender, or an
// endpoint, and it makes no network call.
import { config } from './common.mjs';
import { PLANS } from '../engine/entitlements.mjs';
import { licensingStatus } from './licensing.mjs';

/** The checkout URL from vault config, or an empty string when none is set. */
export function checkoutUrl(root) {
  const url = config(root)?.checkout?.url;
  return typeof url === 'string' ? url.trim() : '';
}

/** The plans and the buy lines, as one text block. */
export function plansText() {
  const lines = ['Plans (draft; the full table with prices is docs/PRICING.md):'];
  const width = Math.max(...PLANS.map((p) => p.name.length));
  for (const p of PLANS) lines.push(`  ${p.name.padEnd(width)} ${p.adds}`);
  lines.push('The paid difference is using several computers at once, with automatic merge from a separately licensed engine.');
  lines.push('On any computer, everything is free and unlimited.');
  lines.push('');
  lines.push('Buy:');
  lines.push('  Open the checkout page and pay there, then run memev license activate <key> with the key it emails.');
  lines.push("  This vault prints the checkout page's URL when its config sets checkout.url: memev upgrade.");
  return lines.join('\n');
}

/** The usage of this vault, as `memev plan` prints it. */
export function planLines(status) {
  const l = status.license;
  return [
    l.state === 'none' ? 'Plan: free (no licence; the free tier needs none)' : `Plan: ${status.effective_tier} (licence ${l.lid || 'installed'}: ${l.state})`,
    `Computers: ${status.computers_enrolled} used of ${status.seats_licensed} allowed`,
    `Cloud connectors: ${status.usage.connectors} counted (not limited)`,
  ];
}

export async function command(cmd, pos, flags, { root, env, license = null }) {
  void pos;
  if (cmd === 'plan') {
    const s = licensingStatus({ root, env, license });
    if (flags.json) {
      const l = s.license;
      console.log(JSON.stringify({ plan: s.effective_tier, licence: l.state === 'none' ? null : { lid: l.lid, state: l.state, tier: l.tier }, computers_used: s.computers_enrolled, computers_allowed: s.seats_licensed, connectors_counted: s.usage.connectors }, null, 2));
      return 0;
    }
    for (const line of planLines(s)) console.log(line);
    return 0;
  }
  const url = checkoutUrl(root);
  if (url) { console.log(url); return 0; }
  console.log(plansText());
  return 0;
}
