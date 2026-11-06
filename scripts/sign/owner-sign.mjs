// Sign one contract with the owner's key, through memev's own contractDraft and contractSign. Runs only under
// owner-key-preload.mjs, which holds the key in memory, parses the flags and makes the checks; see the usage there. This
// file takes no flags of its own, so what he was shown is what it signs. Nothing is written to the clone. The signed body
// goes to the signing vault, and a pull request brings it to the repository.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const stop = (m) => { console.error(`Refused: ${m}. Nothing was signed.`); process.exit(2); };
const opt = globalThis[Symbol.for('memev.owner.sign')];
if (!opt) stop('this runs only under the owner key preload');
// lstat is not one of the calls the preload answers for, so this looks at the real file.
const real = fs.lstatSync(opt.view);
if (!real.isFile() || real.size !== 0) stop(`${opt.view} must be an empty file`);

const { code } = opt;
const { Vault, initVault } = await import(pathToFileURL(path.join(code, 'src', 'engine', 'vault.mjs')).href);
const gate = await import(pathToFileURL(path.join(code, 'src', 'engine', 'redteam-gate.mjs')).href);
const specAbs = path.join(code, opt.spec);
const raw = fs.readFileSync(specAbs); const spec = JSON.parse(raw);
if (crypto.createHash('sha256').update(raw).digest('hex') !== opt.fileSha) stop('the spec file changed after it was shown to you');
const before = gate.evaluate({ spec: opt.spec, cwd: code });
if (before.status !== 'SIGNABLE' || before.signable_sha256 !== opt.signable) stop(`the gate's answer changed after it was shown to you: ${before.status}`);

const blob = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
const crit = (x) => x.tasks.reduce((a, t) => a + t.criteria.length, 0);
const root = path.resolve(opt.vault);
if (!fs.existsSync(path.join(root, '.memev'))) initVault(root, { template: path.join(code, 'templates', 'vault') });
// Point the vault's gate at the clone for this run, and put the setting back afterwards.
const cfgFile = path.join(root, '.memev', 'config.json');
const cfgBefore = fs.existsSync(cfgFile) ? fs.readFileSync(cfgFile, 'utf8') : null;
const cfg = cfgBefore ? JSON.parse(cfgBefore) : {};
cfg.contracts = { ...(cfg.contracts || {}), redteam_root: code };
fs.writeFileSync(cfgFile, `${JSON.stringify(cfg, null, 2)}\n`);

const v = new Vault(root, { keyDir: opt.view, commitDelayMs: 10 }).open();
const ID = { id: 'signing', agent: 'owner', scopes: ['read', 'write', 'admin'], paths: ['**'] };
let rc = 1; let bodyAt = null;
try {
  if (!v.config?.contracts?.redteam_root) throw new Error('the vault did not load contracts.redteam_root');
  const d = v.contractDraft(ID, {
    title: spec.title, project: spec.project, workdir: spec.workdir ?? null, request: spec.request, tasks: spec.tasks,
    ...(opt.supersedes ? { supersedes: opt.supersedes, version: opt.version } : {}),
    base: opt.base, provenance: { record: opt.record, review: opt.review }, spec: specAbs,
  });
  const s = v.contractSign(ID, { id: d.id, local: true });
  bodyAt = path.join(root, 'contracts', 'signed', `${d.id}.json`);
  const chk = v.contractCheckSignature(d.id);
  if (!chk.ok) throw new Error(`signature check failed for ${d.id}: ${chk.detail}`);
  if (s.keyid !== opt.keyId) throw new Error(`signed by ${s.keyid}, and the command names ${opt.keyId}`);
  const signed = JSON.parse(fs.readFileSync(bodyAt, 'utf8'));
  if (signed.title !== spec.title) throw new Error('the signed title is not the spec\'s title');
  if (signed.base?.sha !== opt.base) throw new Error('the signed contract does not carry the base asked for');
  if (opt.supersedes && (signed.version !== opt.version || signed.supersedes !== opt.supersedes)) throw new Error('the signed contract does not carry the version or supersedes asked for');
  if (crit(signed) !== crit(spec) || signed.tasks.length !== spec.tasks.length) throw new Error('the signed tasks or criteria count differs from the spec');
  if (signed.provenance?.spec_sha256 !== opt.signable) throw new Error('provenance.spec_sha256 is not the hash the gate judged signable');
  const rec = { at: new Date().toISOString(), spec_file: opt.spec, spec_blob: blob(raw), spec_sha256: opt.signable, commit: opt.commit, base: opt.base, contract: d.id, hash: s.hash, keyid: s.keyid, tasks: signed.tasks.length, criteria: crit(signed), go: opt.go };
  fs.appendFileSync(opt.out, `${JSON.stringify(rec)}\n`);
  console.log(`Signed: ${signed.title}`);
  console.log(`  contract ${d.id}, key ${s.keyid}, hash ${s.hash}`);
  console.log(`  base ${signed.base.sha}, gate hash ${signed.provenance.spec_sha256}`);
  console.log(`  ${signed.tasks.length} tasks, ${crit(signed)} criteria, signature ok`);
  rc = 0;
} catch (e) {
  if (bodyAt) console.error(`STOPPED AFTER SIGNING: ${e.message}. A signed body exists at ${bodyAt}. Do not land it; tell the lead.`);
  else console.error(`Refused: ${e.message}. Nothing was signed.`);
} finally {
  try { v.commits?.flush?.(); } catch (e) { console.error(`commit flush: ${e.message}`); }
  v.close();
  if (cfgBefore === null) fs.rmSync(cfgFile, { force: true }); else fs.writeFileSync(cfgFile, cfgBefore);
}
process.exit(rc);
