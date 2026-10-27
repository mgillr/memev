// SPDX-License-Identifier: Apache-2.0
// Service providers: where sync, remote access and backup come from. Today every provider is one
// the user runs or owns (git to their own repository, their own tunnel). Hosted providers are
// listed so the daemon and the docs have one place to describe them; none exists yet, and adding
// one never removes a free provider (CHARTER.md).
import { git } from '../engine/git.mjs';
import { can } from '../engine/entitlements.mjs';
import { spawnSync } from 'node:child_process';

const which = (bin) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' }).status === 0;

const hostedLater = (id, feature, what) => ({ id, hosted: true, feature, available: () => ({ ok: false, reason: `${what} is not offered yet` }) });

export const PROVIDERS = {
  sync: [
    { id: 'git', hosted: false, feature: null, describe: 'git to your own remote (single writer)',
      available: ({ root }) => { const r = git(root, ['remote']).out; return r ? { ok: true } : { ok: false, reason: 'no git remote (memev github setup)' }; },
      run: async (vault, ctx) => (await import('../cli/sync.mjs')).syncOnce(vault, ctx) },
    hostedLater('memev-sync', 'sync_hosted', 'end-to-end encrypted sync between computers'),
  ],
  remote: [
    { id: 'tailscale', hosted: false, feature: null, describe: 'Tailscale Funnel (your tailnet)', available: () => (which('tailscale') ? { ok: true } : { ok: false, reason: 'tailscale is not installed' }) },
    { id: 'cloudflare', hosted: false, feature: null, describe: 'your named Cloudflare tunnel', available: ({ config }) => (config?.remote?.cloudflare?.name ? { ok: true } : { ok: false, reason: 'no named tunnel configured' }) },
    { id: 'quick', hosted: false, feature: null, describe: 'Cloudflare quick tunnel (no account)', available: () => ({ ok: true }) },
    hostedLater('memev-relay', 'relay_hosted', 'a stable hosted relay address'),
  ],
  backup: [
    { id: 'git', hosted: false, feature: null, describe: 'your own private GitHub repository', available: ({ root }) => (git(root, ['remote']).out ? { ok: true } : { ok: false, reason: 'no git remote (memev github setup)' }) },
    hostedLater('memev-backup', 'backup_hosted', 'hosted encrypted backup'),
  ],
};

/** Every provider for a service with whether it can be used here. Hosted ones are never selected today. */
export function providers(service, ctx) {
  return (PROVIDERS[service] || []).map((p) => {
    const a = p.hosted && !can(p.feature) ? { ok: false, reason: p.available(ctx).reason } : p.available(ctx);
    return { id: p.id, hosted: p.hosted, describe: p.describe || null, ok: a.ok, reason: a.reason || null };
  });
}

/** The provider in use: the configured one if usable, else the first usable free one. */
export function selectProvider(service, ctx) {
  const want = ctx.config?.[service]?.provider;
  const all = PROVIDERS[service] || [];
  const usable = (p) => !p.hosted && p.available(ctx).ok;
  return all.find((p) => p.id === want && usable(p)) || all.find(usable) || null;
}
