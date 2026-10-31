// SPDX-License-Identifier: Apache-2.0
// `memev agentid` binds an agent role to a person, verifies a stored binding, and sets one up.
// Binding and setup are part of Business and Corporate; verification is free on every tier.
// The work is done by the MEM-145 engine in ../engine/agentid-bind.mjs; this is only the command
// surface, the tier gate and the output.
import path from 'node:path';
import { isVault } from '../engine/vault.mjs';
import { loadLicense } from '../engine/license.mjs';
import { limitsFor } from '../engine/entitlements.mjs';
import { bindAgentRole, verifyAgentBinding, setupAgentRole, AgentBindError } from '../engine/agentid-bind.mjs';

const STATE = '.memev';
// The tiers that may bind. canonicalTier folds team/office into business and enterprise into
// corporate, so the live tier is one of these when the licence is Business or Corporate.
const PAID_TIERS = ['team', 'office', 'business', 'enterprise', 'corporate'];
const REFUSAL = 'Binding agent roles is part of Business and Corporate. Run memev upgrade.';
const SUBS = ['bind', 'verify', 'setup'];

const agentsDir = (root) => path.join(root, STATE, 'keys', 'agents');
const trustDir = (root) => path.join(root, STATE, 'keys', 'trust');

function usage() {
  return 'usage: memev agentid bind <role> --principal <who> --ssh-key <path>\n' +
    '       memev agentid verify <role> --principal <who> --allowed-signers <file>\n' +
    '       memev agentid setup <role> --principal <who> --ssh-key <path>';
}

// One line of output: the JSON object when --json is set, else the text form.
function emit(flags, text, json) {
  if (flags.json) console.log(JSON.stringify(json));
  else console.log(text);
}

export async function command(_cmd, pos, flags, { root, env, license = null }) {
  if (!isVault(root)) throw new Error(`no vault at ${root}; run memev init`);
  const [sub, role] = pos;
  if (!sub || !SUBS.includes(sub) || !role) {
    emit(flags, usage(), { ok: false, error: usage() });
    return 2;
  }
  const lic = license || loadLicense({ env });
  // verify is free everywhere; bind and setup are part of Business and Corporate
  if (sub !== 'verify' && !PAID_TIERS.includes(limitsFor(lic).tier)) {
    emit(flags, REFUSAL, { ok: false, error: REFUSAL });
    return 1;
  }
  try {
    if (sub === 'verify') {
      const principal = flags.principal;
      const allowedSigners = flags['allowed-signers'];
      if (!principal || !allowedSigners) {
        emit(flags, usage(), { ok: false, error: usage() });
        return 2;
      }
      const status = verifyAgentBinding(role, { allowedSigners, principal, dir: agentsDir(root) });
      const ok = status === 'bound';
      emit(flags, `role: ${role}\nprincipal: ${principal}\nstatus: ${status}`, { ok, role, principal, status });
      return ok ? 0 : 1;
    }
    const principal = flags.principal;
    const sshKeyPath = flags['ssh-key'];
    if (!principal || !sshKeyPath) {
      emit(flags, usage(), { ok: false, error: usage() });
      return 2;
    }
    if (sub === 'bind') {
      const r = bindAgentRole(role, { sshKeyPath, principal, dir: agentsDir(root) });
      emit(flags, `role: ${r.role}\nprincipal: ${r.principal}\nsignature: ${r.sshsig}`, { ok: true, role: r.role, principal: r.principal, signature: r.sshsig });
      return 0;
    }
    const r = setupAgentRole(role, { principal, sshKeyPath, trustDir: trustDir(root), dir: agentsDir(root) });
    const dir = agentsDir(root);
    const rolePub = path.join(dir, `${r.role}.pub`);
    const signature = path.join(dir, `${r.role}.pub.sshsig`);
    const allowedSigners = path.join(trustDir(root), 'allowed_signers');
    emit(flags,
      `role: ${r.role}\nprincipal: ${r.principal}\npublic key: ${rolePub}\nsignature: ${signature}\nallowed signers: ${allowedSigners}`,
      { ok: true, role: r.role, principal: r.principal, public_key: rolePub, signature, allowed_signers: allowedSigners });
    return 0;
  } catch (e) {
    const msg = e instanceof AgentBindError ? e.message : (e && e.message) || String(e);
    emit(flags, msg, { ok: false, error: msg });
    return 1;
  }
}
