// Sign one contract with the owner's key, through memev's own contractDraft and contractSign, run in process from a
// fresh clone. Run only under owner-key-preload.mjs, which holds the key in memory. The contract carries its base commit
// and its red-team record, and it is judged by the gate of the clone at draft, at sign, and here before and after.
// usage: node --import <clone>/scripts/sign/owner-key-preload.mjs <clone>/scripts/sign/owner-sign.mjs
//        --code <clone> --vault <signing vault> --keydir ~/.config/memev-owner/view
//        --spec <spec path in the clone> --record <red-team record path in the clone> --review <text>
//        --base <40-hex sha> --out <log.jsonl> --go <owner's words> [--supersedes <contract id> --version <n>]
// Nothing is written to the clone. The signed body goes to the signing vault, and a pull request brings it to the repo.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2); const opt = {};
for (let i = 0; i < args.length; i++) { if (args[i].startsWith('--')) opt[args[i].slice(2)] = args[++i]; }
const stop = (m) => { console.error(`Refused: ${m}. Nothing was signed.`); process.exit(2); };
for (const k of ['code', 'vault', 'keydir', 'spec', 'record', 'review', 'base', 'out', 'go']) if (!opt[k]) stop(`missing --${k}`);
if (!/^[0-9a-f]{40}$/.test(opt.base)) stop('--base must be a 40-hex sha');
if (Boolean(opt.supersedes) !== Boolean(opt.version)) stop('--supersedes and --version go together');
const version = opt.version ? Number(opt.version) : null;
if (opt.version && (!Number.isInteger(version) || version < 2)) stop('--version must be an integer of 2 or more');
const expected = process.env.MEMEV_OWNER_KEY_ID;
if (!/^[0-9a-f]{16}$/.test(expected || '')) stop('this runs only under the owner key preload');

const code = fs.realpathSync(path.resolve(opt.code));
const specAbs = path.join(code, opt.spec);
for (const f of [specAbs, path.join(code, opt.record)]) if (!fs.existsSync(f)) stop(`not in the clone: ${f}`);
const { Vault, initVault } = await import(pathToFileURL(path.join(code, 'src', 'engine', 'vault.mjs')).href);
const gate = await import(pathToFileURL(path.join(code, 'src', 'engine', 'redteam-gate.mjs')).href);

const blob = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
const crit = (x) => x.tasks.reduce((a, t) => a + t.criteria.length, 0);
const raw = fs.readFileSync(specAbs); const spec = JSON.parse(raw);
const before = gate.evaluate({ spec: opt.spec, cwd: code });
if (before.status !== 'SIGNABLE') stop(`the gate says ${before.status}: ${(before.reasons || []).join('; ')}`);

const root = path.resolve(opt.vault);
if (!fs.existsSync(path.join(root, '.memev'))) initVault(root, { template: path.join(code, 'templates', 'vault') });
fs.mkdirSync(opt.keydir, { recursive: true, mode: 0o700 });
// Point the vault's gate at the clone for this run, and put the setting back afterwards.
const cfgFile = path.join(root, '.memev', 'config.json');
const cfgBefore = fs.existsSync(cfgFile) ? fs.readFileSync(cfgFile, 'utf8') : null;
const cfg = cfgBefore ? JSON.parse(cfgBefore) : {};
cfg.contracts = { ...(cfg.contracts || {}), redteam_root: code };
fs.writeFileSync(cfgFile, `${JSON.stringify(cfg, null, 2)}\n`);

const v = new Vault(root, { keyDir: path.resolve(opt.keydir), commitDelayMs: 10 }).open();
const ID = { id: 'signing', agent: 'owner', scopes: ['read', 'write', 'admin'], paths: ['**'] };
let rc = 1;
try {
  if (!v.config?.contracts?.redteam_root) throw new Error('the vault did not load contracts.redteam_root');
  const d = v.contractDraft(ID, {
    title: spec.title, project: spec.project, workdir: spec.workdir ?? null, request: spec.request, tasks: spec.tasks,
    ...(opt.supersedes ? { supersedes: opt.supersedes, version } : {}),
    base: opt.base, provenance: { record: opt.record, review: opt.review }, spec: specAbs,
  });
  const s = v.contractSign(ID, { id: d.id, local: true });
  const chk = v.contractCheckSignature(d.id);
  if (!chk.ok) throw new Error(`signature check failed for ${d.id}: ${chk.detail}`);
  if (s.keyid !== expected) throw new Error(`signed by ${s.keyid}, and the command names ${expected}`);
  const signed = JSON.parse(fs.readFileSync(path.join(root, 'contracts', 'signed', `${d.id}.json`), 'utf8'));
  if (signed.base?.sha !== opt.base) throw new Error('the signed contract does not carry the base asked for');
  if (opt.supersedes && (signed.version !== version || signed.supersedes !== opt.supersedes)) throw new Error('the signed contract does not carry the version or supersedes asked for');
  if (crit(signed) !== crit(spec) || signed.tasks.length !== spec.tasks.length) throw new Error('the signed tasks or criteria count differs from the spec');
  if (signed.provenance?.spec_sha256 !== before.signable_sha256) throw new Error('provenance.spec_sha256 is not the hash the gate judged signable');
  const rec = { at: new Date().toISOString(), spec_file: opt.spec, spec_blob: blob(raw), spec_sha256: before.signable_sha256, base: opt.base, contract: d.id, hash: s.hash, keyid: s.keyid, tasks: signed.tasks.length, criteria: crit(signed), go: opt.go };
  fs.appendFileSync(opt.out, `${JSON.stringify(rec)}\n`);
  console.log(`Signed ${d.id}: key ${s.keyid}, hash ${s.hash}, ${signed.tasks.length} tasks, ${crit(signed)} criteria, signature ok.`);
  rc = 0;
} catch (e) { console.error(`Refused: ${e.message}`); }
finally {
  try { v.commits?.flush?.(); } catch (e) { console.error(`commit flush: ${e.message}`); }
  v.close();
  if (cfgBefore === null) fs.rmSync(cfgFile, { force: true }); else fs.writeFileSync(cfgFile, cfgBefore);
}
process.exit(rc);
