// The owner's signing route, until SR-0.04 T9 builds this into `memev contract sign`. Run only as:
//   MEMEV_OWNER_KEY_ID=<key id> node --import <clone>/scripts/sign/owner-key-preload.mjs <clone>/scripts/sign/owner-sign.mjs \
//     --code <clone> --commit <sha> --vault <signing vault> --spec <path> --record <path> --signable <gate hash> \
//     --review <text> --base <sha> --out <log.jsonl> --go <owner's words> [--supersedes <contract id> --version <n>]
// This file parses the flags, once, and owner-sign.mjs reads the result from it: what he is shown is what is signed.
// Every check that can run before the passphrase runs before it. Then it asks on the terminal, decrypts in memory, and shows
// the decrypted key only to memev's signing code, at one virtual path, for this one process. Nothing is written to disk.
// There is no flag or environment variable for the passphrase: with no terminal it refuses and signs nothing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const stop = (m) => { console.error(`Refused: ${m}. Nothing was signed.`); process.exit(2); };
const KEY = path.join(os.homedir(), '.config', 'memev-owner', 'owner-ed25519.pem');
const VIEW = path.join(os.homedir(), '.config', 'memev-owner', 'view');
const VIRTUAL = path.join(VIEW, 'contract-ed25519.pem');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

// One parser. A flag that is repeated, unknown or has no value stops the run.
const REQUIRED = ['code', 'commit', 'vault', 'spec', 'record', 'signable', 'review', 'base', 'out', 'go'];
const OPTIONAL = ['supersedes', 'version'];
const opt = {};
const words = process.argv.slice(2);
for (let i = 0; i < words.length; i += 2) {
  const k = words[i]?.startsWith('--') ? words[i].slice(2) : null;
  if (!k || ![...REQUIRED, ...OPTIONAL].includes(k)) stop(`${words[i]} is not a flag of this command`);
  if (k in opt) stop(`--${k} is given twice`);
  if (words[i + 1] === undefined || words[i + 1].startsWith('--')) stop(`--${k} has no value`);
  opt[k] = words[i + 1];
}
for (const k of REQUIRED) if (!opt[k]) stop(`the command must name --${k}`);
for (const k of ['commit', 'base']) if (!/^[0-9a-f]{40}$/.test(opt[k])) stop(`--${k} must be a 40-hex sha`);
if (!/^[0-9a-f]{64}$/.test(opt.signable)) stop('--signable must be the 64-hex hash the gate reports');
if (Boolean(opt.supersedes) !== Boolean(opt.version)) stop('--supersedes and --version go together');
const version = opt.version ? Number(opt.version) : null;
if (opt.version && (!Number.isInteger(version) || version < 2)) stop('--version must be an integer of 2 or more');
const expected = process.env.MEMEV_OWNER_KEY_ID;
if (!/^[0-9a-f]{16}$/.test(expected || '')) stop('the command must name your key id');
// Nothing else may load beside this process's two programs.
for (const k of ['NODE_OPTIONS', 'NODE_PATH']) if (process.env[k]) stop(`${k} is set in this shell, and could load another program beside the key; unset it`);
const self = fs.realpathSync(fileURLToPath(import.meta.url));
const loaded = process.execArgv;
let loadedFile = '';
try { loadedFile = loaded.length === 2 && loaded[0] === '--import' ? fs.realpathSync(loaded[1]) : ''; } catch { /* compared below */ }
if (loadedFile !== self) stop('node must be given this one --import and nothing else');

// The key file, and the view: a real empty file, so a run with this preload left off cannot generate a key there.
if (!fs.existsSync(KEY)) stop(`no key at ${KEY}`);
let viewStat = null;
try { viewStat = fs.lstatSync(VIEW); } catch { /* absent: made here */ }
if (viewStat && !(viewStat.isFile() && viewStat.size === 0)) stop(`${VIEW} must be an empty file; something else is there, so look at it first`);
if (!viewStat) fs.closeSync(fs.openSync(VIEW, 'wx', 0o600));
const pem = fs.readFileSync(KEY, 'utf8');
if (!pem.includes('BEGIN ENCRYPTED PRIVATE KEY')) stop('the key file is not encrypted');
if ((fs.statSync(KEY).mode & 0o077) !== 0) stop('the key file can be read by others; run chmod 600 on it');

// The clone: these two programs, at the stated commit, with nothing changed.
let code;
try { code = fs.realpathSync(opt.code); } catch { stop(`--code ${opt.code} does not exist`); }
// A plain environment, so GIT_DIR and the like in his shell cannot change what these checks see.
const git = (...a) => execFileSync('/usr/bin/git', ['-C', code, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { PATH: '/usr/bin:/bin', HOME: os.homedir() }, maxBuffer: 1 << 26 }).trim();
const preloadFile = path.join(code, 'scripts', 'sign', 'owner-key-preload.mjs');
const toolFile = path.join(code, 'scripts', 'sign', 'owner-sign.mjs');
if (self !== preloadFile) stop('this preload is not the clone\'s own copy');
let script = '';
try { script = fs.realpathSync(process.argv[1] || ''); } catch { /* compared below */ }
if (script !== toolFile) stop('this key is given only to the clone\'s scripts/sign/owner-sign.mjs');
let head = ''; let dirty = '';
try { head = git('rev-parse', 'HEAD'); dirty = git('status', '--porcelain'); } catch { stop('--code is not a git clone'); }
if (head !== opt.commit) stop(`the clone is at ${head}, and the command names ${opt.commit}`);
if (dirty) stop('the clone has changes, so it is not the commit it says it is');
// `status` does not see a file marked assume-unchanged or skip-worktree, so these look past it.
if (git('ls-files', '-v').split('\n').some((l) => /^[a-zS]/.test(l))) stop('the clone hides files from git, so it is not the commit it says it is');
for (const f of [preloadFile, toolFile]) {
  const rel = path.relative(code, f);
  if (git('rev-parse', `HEAD:${rel}`) !== git('hash-object', '--no-filters', f)) stop(`${rel} is not the copy in the stated commit`);
}
try { git('cat-file', '-e', `${opt.base}^{commit}`); git('merge-base', '--is-ancestor', opt.base, head); } catch { stop(`--base ${opt.base} is not a commit behind the clone's HEAD`); }
const specAbs = path.join(code, opt.spec);
for (const f of [specAbs, path.join(code, opt.record)]) if (!fs.existsSync(f)) stop(`not in the clone: ${f}`);

// The gate of this clone, before the passphrase.
const specRaw = fs.readFileSync(specAbs); const spec = JSON.parse(specRaw);
// the engine refuses more at the draft, which comes after the passphrase; test/owner-sign.test.mjs holds this number to the engine's
const REQUEST_MAX = 16000;
if (typeof spec.request === 'string' && spec.request.length > REQUEST_MAX) stop(`the spec's request is ${spec.request.length} characters and a contract holds ${REQUEST_MAX}`);
const gate = await import(pathToFileURL(path.join(code, 'src', 'engine', 'redteam-gate.mjs')).href);
const judged = gate.evaluate({ spec: opt.spec, cwd: code });
if (judged.status !== 'SIGNABLE') stop(`the gate says ${judged.status}: ${(judged.reasons || []).join('; ').slice(0, 600)}`);
if (judged.signable_sha256 !== opt.signable) stop(`the gate judged ${judged.signable_sha256}, and the command names ${opt.signable}`);
if (judged.record !== opt.record) stop(`this spec's red-team record is ${judged.record}, and the command names ${opt.record}`);

// What the signed body would replace or repeat, in the clone and the signing vault.
const vaultRoot = path.resolve(opt.vault);
if (!fs.existsSync(path.join(vaultRoot, '.memev'))) stop(`--vault ${opt.vault} is not a vault`);
const signedDir = path.join(vaultRoot, 'contracts', 'signed');
const held = fs.existsSync(signedDir) ? fs.readdirSync(signedDir).filter((f) => f.endsWith('.json') && !f.endsWith('.sig.json')) : [];
const title = (d, f) => { try { return JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')).title; } catch { return null; } };
if (opt.supersedes) {
  const f = path.join(code, 'contracts', 'signed', `${opt.supersedes}.json`);
  if (!fs.existsSync(f)) stop(`not in the clone: ${f}`);
  const old = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (old.title !== spec.title) stop('the superseded contract\'s title is not the spec\'s title');
  if ((old.version || 1) + 1 !== version) stop(`the superseded contract is version ${old.version || 1}; --version must be ${(old.version || 1) + 1}`);
} else {
  if (held.some((f) => title(signedDir, f) === spec.title)) stop('the signing vault already holds a signed body with this title, and the command supersedes nothing');
  const inClone = path.join(code, 'contracts', 'signed');
  const landed = fs.existsSync(inClone) ? fs.readdirSync(inClone).filter((f) => f.endsWith('.json') && !f.endsWith('.sig.json')) : [];
  if (landed.some((f) => title(inClone, f) === spec.title)) stop('the clone already holds a signed body with this title, and the command supersedes nothing');
}
// The log must be writable before his key signs anything. No file is made until there is something to put in it.
const outAbs = path.resolve(opt.out);
try { fs.accessSync(fs.existsSync(outAbs) ? outAbs : path.dirname(outAbs), fs.constants.W_OK); } catch { stop(`--out ${opt.out} cannot be written`); }

// A terminal, last, so every check above can be tested without one.
let tty;
try { tty = fs.openSync('/dev/tty', 'r+'); } catch { stop('this needs your own Terminal, so a passphrase can be typed'); }

// Show what is being signed, then ask.
const fileSha = sha256(specRaw);
console.log(`Clone at commit: ${head} (no changes)`);
console.log(`These programs' sha256: preload ${sha256(fs.readFileSync(preloadFile))}, tool ${sha256(fs.readFileSync(toolFile))}`);
console.log(`Base commit: ${opt.base}`);
console.log(`You are signing: ${spec.title}`);
console.log(`  gate: SIGNABLE, hash ${judged.signable_sha256}`);
console.log(`  spec file sha256: ${fileSha}`);
console.log(`  with key: ${expected}`);

function askPassphrase() {
  fs.writeSync(tty, 'Passphrase for your signing key (Ctrl-C to stop): ');
  // A child reads it, so Ctrl-C works during the wait and always puts echo back. It leaves on a pipe, never an argument.
  const keep = () => {};
  process.on('SIGINT', keep); process.on('SIGTERM', keep); process.on('SIGHUP', keep);
  const r = spawnSync('/bin/sh', ['-c', 'trap \'/bin/stty echo; exit 130\' INT TERM HUP; /bin/stty -echo; IFS= read -r p; rc=$?; /bin/stty echo; [ "$rc" -eq 0 ] || exit 3; printf %s "$p"'], { stdio: [tty, 'pipe', 'ignore'], encoding: 'utf8' });
  process.off('SIGINT', keep); process.off('SIGTERM', keep); process.off('SIGHUP', keep);
  fs.writeSync(tty, '\n'); fs.closeSync(tty);
  if (r.status !== 0) stop('stopped at the passphrase');
  return r.stdout;
}

let priv;
try { priv = crypto.createPrivateKey({ key: pem, passphrase: askPassphrase() }); }
catch { stop('the passphrase is wrong or the key file is damaged'); }
if (priv.asymmetricKeyType !== 'ed25519') stop('this is not an Ed25519 key');
const keyId = sha256(crypto.createPublicKey(priv).export({ type: 'spki', format: 'der' })).slice(0, 16);
if (keyId !== expected) stop(`this key is ${keyId}, and the command names ${expected}`);
const plain = priv.export({ type: 'pkcs8', format: 'pem' });

const hit = (p) => typeof p === 'string' && path.resolve(p) === VIRTUAL;
const under = (p) => typeof p === 'string' && path.resolve(p) === VIEW;
const { readFileSync, existsSync, statSync, mkdirSync, accessSync, openSync, writeFileSync } = fs;
// The engine must never generate a key here: any attempt to write at or under the view stops the run through the tool's own cleanup.
const refuseWrite = (p) => { if (typeof p === 'string' && (path.resolve(p) === VIEW || path.resolve(p).startsWith(VIEW + path.sep))) throw new Error('something tried to write a key file'); };
fs.openSync = function (p, flags, ...a) { if (flags && flags !== 'r') refuseWrite(p); return openSync.call(fs, p, flags, ...a); };
fs.writeFileSync = function (p, ...a) { refuseWrite(p); return writeFileSync.call(fs, p, ...a); };
fs.accessSync = function (p, ...a) { if (hit(p) || under(p)) return undefined; return accessSync.call(fs, p, ...a); };
fs.readFileSync = function (p, ...a) {
  if (hit(p)) { const enc = a[0]?.encoding ?? a[0]; return enc ? String(plain) : Buffer.from(String(plain)); }
  return readFileSync.call(fs, p, ...a);
};
fs.existsSync = function (p) { return hit(p) || under(p) || existsSync.call(fs, p); };
fs.statSync = function (p, ...a) {
  if (hit(p)) return { isFile: () => true, isDirectory: () => false, size: String(plain).length, mode: 0o600 };
  if (under(p)) return { isFile: () => false, isDirectory: () => true, size: 0, mode: 0o700 };
  return statSync.call(fs, p, ...a);
};
fs.mkdirSync = function (p, ...a) { if (under(p)) return undefined; return mkdirSync.call(fs, p, ...a); };
syncBuiltinESMExports();

// The tool reads the parsed flags from here and takes none of its own.
globalThis[Symbol.for('memev.owner.sign')] = Object.freeze({ ...opt, code, version, view: VIEW, keyId, fileSha, signable: judged.signable_sha256 });
