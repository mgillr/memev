#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// A signed record beside a signed contract that has no base. It names the contract's hash and the base, so verify can judge
// the contract without the body being signed again. The base is never chosen: it is the parent of the commit that first
// added the body. Nothing is written without --key.
// Usage: node scripts/contracts/base-record.mjs --repo DIR --id ID [--key PEM_FILE --by NAME]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { sign, canonicalHash } from '../../vendor/attest/signature.mjs';

const SHA40 = /^[0-9a-f]{40}$/;
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** The parent of the commit that first added contracts/signed/<id>.json. */
export function mechanicalBase({ repo, id }) {
  const added = git(repo, 'log', '--diff-filter=A', '--format=%H', '--', `contracts/signed/${id}.json`).split('\n').filter(Boolean);
  if (!added.length) throw new Error(`${id} was never committed in ${repo}, so it has no base`);
  const first = added[added.length - 1];
  let parent;
  try { parent = git(repo, 'rev-parse', '--verify', '--quiet', `${first}^`); } catch { parent = ''; }
  if (!SHA40.test(parent)) throw new Error(`the commit that first added ${id} has no parent, so it has no base`);
  return parent;
}

/** The record for one contract, signed. The signature covers everything except itself. */
export function signBaseRecord({ contract, sha, privateKeyPem, by, at = new Date().toISOString() }) {
  if (!SHA40.test(String(sha))) throw new Error('a base is a commit sha of 40 hex characters');
  const body = { id: contract.id, contract_hash: canonicalHash(contract), base: { sha, recorded_at: at }, at, by };
  return { ...body, sig: sign(body, privateKeyPem) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const opt = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const repo = path.resolve(opt('--repo') || '.'); const id = opt('--id');
  if (!id || !/^[a-zA-Z0-9._-]+$/.test(id)) { console.error('usage: base-record.mjs --repo DIR --id ID [--key PEM_FILE --by NAME]'); process.exit(2); }
  const file = path.join(repo, 'contracts', 'signed', `${id}.json`);
  const contract = JSON.parse(fs.readFileSync(file, 'utf8'));
  const sha = mechanicalBase({ repo, id });
  if (!opt('--key')) { console.log(JSON.stringify({ id, contract_hash: canonicalHash(contract), base: sha })); process.exit(0); }
  const rec = signBaseRecord({ contract, sha, privateKeyPem: fs.readFileSync(opt('--key'), 'utf8'), by: opt('--by') || 'unnamed' });
  fs.writeFileSync(path.join(repo, 'contracts', 'signed', `${id}.base.txt`), `${JSON.stringify(rec, null, 2)}\n`);
  console.log(JSON.stringify({ id, base: sha, written: true }));
}
