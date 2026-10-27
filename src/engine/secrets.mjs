// SPDX-License-Identifier: Apache-2.0
// The secrets guard: text that looks like a credential is refused unless the caller says allow_secrets.
const PATTERNS = [
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
  ['OpenAI-style key', /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['Memev token', /\bmv_[0-9a-f]{8}_[0-9a-f]{32,}\b/],
  ['password assignment', /\b(?:password|passwd|pwd|secret|api[_-]?key)\s*[:=]\s*["']?[^\s"']{8,}/i],
];
export function findSecrets(text) {
  const hits = [];
  for (const [kind, re] of PATTERNS) if (re.test(String(text || ''))) hits.push(kind);
  return hits;
}
export function redactSecrets(text) {
  let out = String(text || '');
  for (const [, re] of PATTERNS) out = out.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`), '[redacted]');
  return out;
}
