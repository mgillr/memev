// SPDX-License-Identifier: Apache-2.0
// Vendored into Memev from an Apache-2.0 project (see LICENSE and NOTICE in this folder).
// Modified for Memev: the canonical form and the DSSE pre-authentication encoding are kept as they
// were; signing uses node:crypto Ed25519 with a local key instead of an external signing tool, and
// verification takes the public key as an argument instead of a fixed path.
import crypto from 'node:crypto';

export const PAYLOAD_TYPE = 'application/vnd.memev.contract-sha256';

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const canonicalHash = (contract) => crypto.createHash('sha256').update(canonical(contract)).digest('hex');

export function pae(payloadType, body) {
  const t = Buffer.from(payloadType);
  const b = Buffer.from(body);
  return Buffer.concat([Buffer.from(`DSSEv1 ${t.length} `), t, Buffer.from(` ${b.length} `), b]);
}

export const keyId = (publicKeyPem) => crypto.createHash('sha256').update(crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);

/** A DSSE envelope over the contract's canonical hash. */
export function sign(contract, privateKeyPem) {
  const hash = canonicalHash(contract);
  const key = crypto.createPrivateKey(privateKeyPem);
  const pub = crypto.createPublicKey(key).export({ type: 'spki', format: 'pem' });
  const sig = crypto.sign(null, pae(PAYLOAD_TYPE, Buffer.from(hash)), key).toString('base64');
  return { payloadType: PAYLOAD_TYPE, payload: Buffer.from(hash).toString('base64'), signatures: [{ keyid: keyId(pub), sig }] };
}

export function verify(contract, envelope, publicKeyPem) {
  if (!envelope || envelope.payloadType !== PAYLOAD_TYPE || typeof envelope.payload !== 'string') return { ok: false, detail: 'not a contract signature' };
  const payload = Buffer.from(envelope.payload, 'base64').toString('utf8');
  if (payload !== canonicalHash(contract)) return { ok: false, detail: 'the signature is not over the current contract (it was changed after signing)' };
  const sig = envelope.signatures?.[0]?.sig;
  if (typeof sig !== 'string') return { ok: false, detail: 'signature missing' };
  try {
    const ok = crypto.verify(null, pae(PAYLOAD_TYPE, Buffer.from(payload)), crypto.createPublicKey(publicKeyPem), Buffer.from(sig, 'base64'));
    return ok ? { ok: true, detail: 'signature matches' } : { ok: false, detail: 'signature does not verify against the key' };
  } catch { return { ok: false, detail: 'unusable public key' }; }
}

export function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { publicKey: publicKey.export({ type: 'spki', format: 'pem' }), privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}
