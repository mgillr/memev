// SPDX-License-Identifier: Apache-2.0
// `memev deployment`: where this vault runs (local, on-prem or cloud-hosted), what kind of AI
// provider it uses (hosted-api, internal-llm or mixed), and the trial path that fits the choice.
// The vault config holds deployment.mode and deployment.ai_provider; absent keys read as local
// and unset, and nothing writes them unless `memev deployment set` asks for it.
import path from 'node:path';
import { readJson, writePrivateJson, exists } from '../engine/util.mjs';

export const MODES = ['local', 'on-prem', 'cloud-hosted'];
export const PROVIDERS = ['hosted-api', 'internal-llm', 'mixed'];

// What runs where, one plain line each, per mode.
export const RUNS_WHERE = {
  local: [
    'The vault server runs on this computer.',
    'Your AI apps on this computer connect to it directly.',
    'Memev holds no provider keys and makes no model calls.',
  ],
  'on-prem': [
    'The vault server runs on your own servers.',
    'Any internal model stays inside your environment.',
    'Memev holds no provider keys and makes no model calls.',
  ],
  'cloud-hosted': [
    'The vault server runs on a host the operator manages (planned, not available yet).',
    'Your computers and AI apps connect to it; calls to an AI provider are made by your own AI apps with your own keys.',
    'Memev holds no provider keys and makes no model calls.',
  ],
};

// The one table behind the trial path: the provider type picks the path, the mode picks the line.
export const TRIAL_PATHS = {
  business: {
    label: 'the self-serve Business trial',
    byMode: {
      local: 'free and self-serve',
      'cloud-hosted': 'free and self-serve',
      'on-prem': 'the trial licence is free and the container install is free; setup done by the operator is a paid service quoted per the rate card in docs/tiers/services.md',
    },
  },
  pilot: {
    label: 'the sales-assisted pilot',
    byMode: {
      local: 'the size is set by order form and the term starts at licence install',
      'cloud-hosted': 'the size is set by order form and the term starts at licence install',
      'on-prem': 'the size is set by order form and the term starts at licence install',
    },
  },
};

export const trialKey = (provider) => (provider === 'internal-llm' ? 'pilot' : 'business');
export const trialPath = (mode, provider) => {
  const t = TRIAL_PATHS[trialKey(provider)];
  return `${t.label}: ${t.byMode[mode] || t.byMode.local}`;
};

/** The deployment the config holds; absent keys read as local and unset. */
export function readDeployment(root) {
  const dep = readJson(path.join(root, '.memev', 'config.json'), {})?.deployment || {};
  return {
    mode: MODES.includes(dep.mode) ? dep.mode : 'local',
    provider: PROVIDERS.includes(dep.ai_provider) ? dep.ai_provider : 'unset',
  };
}

/** Write the keys that were asked for and leave the rest of the config as it was. */
export function setDeployment(root, { mode, ai } = {}) {
  const file = path.join(root, '.memev', 'config.json');
  const cfg = readJson(file, {});
  cfg.deployment = { ...(cfg.deployment || {}) };
  if (mode !== undefined) cfg.deployment.mode = mode;
  if (ai !== undefined) cfg.deployment.ai_provider = ai;
  writePrivateJson(file, cfg);
  return readDeployment(root);
}

export function deploymentView(root) {
  const { mode, provider } = readDeployment(root);
  return { mode, provider, runs_where: RUNS_WHERE[mode], trial_path: trialPath(mode, provider) };
}

export async function command(cmd, pos, flags, { root }) {
  if (!exists(path.join(root, '.memev', 'config.json'))) throw new Error(`no vault at ${root}; run memev init`);
  const sub = pos[0] || 'show';
  if (sub === 'set') {
    const { mode, provider } = set(root, flags, pos[1]);
    console.log(`deployment set: mode ${mode}, provider ${provider}`);
    if ((flags.mode ?? pos[1]) === 'cloud-hosted') console.log('cloud-hosted is planned: the managed service is not available yet; this setting records the choice and changes nothing else.');
    return 0;
  }
  if (sub !== 'show') throw new Error('memev deployment [set --mode M --ai T]');
  const v = deploymentView(root);
  if (flags.json) { console.log(JSON.stringify(v, null, 2)); return 0; }
  console.log(`mode: ${v.mode}\nprovider: ${v.provider}\n\nwhat runs where:\n${v.runs_where.map((l) => `  ${l}`).join('\n')}\n\ntrial path:\n  ${v.trial_path}`);
  return 0;
}

// `memev deployment set local` means the same as --mode local: a remote setup session allows no flags (src/cli/setup-remote.mjs)
function set(root, flags, word) {
  const { mode = word, ai } = flags;
  if (mode !== undefined && !MODES.includes(mode)) throw new Error(`unknown mode: ${mode}; valid modes: ${MODES.join(', ')}`);
  if (ai !== undefined && !PROVIDERS.includes(ai)) throw new Error(`unknown ai provider: ${ai}; valid providers: ${PROVIDERS.join(', ')}`);
  if (mode === undefined && ai === undefined) throw new Error('memev deployment set --mode <local|on-prem|cloud-hosted> [--ai <hosted-api|internal-llm|mixed>]');
  return setDeployment(root, { mode, ai });
}
