// Preload for the owner's first signatures, until SR-0.04 T9 builds this into `memev contract sign`.
// Run with: node --import <this file> sign_held.mjs ... --keydir <OWNER_KEY_VIEW>
// It asks for the passphrase on the terminal, decrypts the owner's key in memory, and shows the decrypted key only to
// memev's signing code, at one virtual path, for this one process. Nothing is written to disk. There is no flag or
// environment variable for the passphrase: with no terminal it refuses and signs nothing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const KEY = path.join(os.homedir(), '.config', 'memev-owner', 'owner-ed25519.pem');
export const VIEW = path.join(os.homedir(), '.config', 'memev-owner', 'view');
const VIRTUAL = path.join(VIEW, 'contract-ed25519.pem');

function askPassphrase() {
  let fd;
  try { fd = fs.openSync('/dev/tty', 'r+'); } catch { console.error('Refused: this needs your own Terminal, so a passphrase can be typed. Nothing was signed.'); process.exit(2); }
  fs.writeSync(fd, 'Passphrase for your signing key: ');
  const restore = () => spawnSync('/bin/stty', ['echo'], { stdio: [fd, 'ignore', 'ignore'] });
  process.once('SIGINT', () => { restore(); process.exit(130); });
  spawnSync('/bin/stty', ['-echo'], { stdio: [fd, 'ignore', 'ignore'] });
  const buf = Buffer.alloc(1024); let got = 0;
  try {
    for (;;) { const n = fs.readSync(fd, buf, got, 1, null); if (!n || buf[got] === 10 || buf[got] === 13) break; got += n; if (got >= buf.length) break; }
  } finally { restore(); fs.writeSync(fd, '\n'); fs.closeSync(fd); }
  const p = buf.subarray(0, got).toString('utf8'); buf.fill(0);
  return p;
}

// VIEW is a real empty file, so a run with this preload left off fails at mkdir and cannot generate a plaintext key there.
// A folder at that path could hold such a key, so it stops the run.
let viewStat = null;
try { viewStat = fs.lstatSync(VIEW); } catch { /* absent: made below */ }
if (viewStat && !(viewStat.isFile() && viewStat.size === 0)) { console.error(`Refused: ${VIEW} must be an empty file. Something else is there; look at it before signing. Nothing was signed.`); process.exit(2); }
if (!viewStat) fs.closeSync(fs.openSync(VIEW, 'wx', 0o600));
if (!fs.existsSync(KEY)) { console.error(`Refused: no key at ${KEY}. Nothing was signed.`); process.exit(2); }
const pem = fs.readFileSync(KEY, 'utf8');
if (!pem.includes('BEGIN ENCRYPTED PRIVATE KEY')) { console.error('Refused: the key file is not encrypted. Nothing was signed.'); process.exit(2); }
if ((fs.statSync(KEY).mode & 0o077) !== 0) { console.error('Refused: the key file can be read by others; run chmod 600 on it. Nothing was signed.'); process.exit(2); }
// The expected key id comes from the command the owner was given. Without it, or with any other key, nothing is signed.
const argv = process.argv; const argOf = (k) => { const i = argv.indexOf(k); return i > 0 ? argv[i + 1] : null; };
const expected = process.env.MEMEV_OWNER_KEY_ID;
if (!/^[0-9a-f]{16}$/.test(expected || '')) { console.error('Refused: the command must name your key id. Nothing was signed.'); process.exit(2); }
// Show what is being signed before asking.
const code = argOf('--code'); const specRel = argOf('--spec');
if (!code || !specRel) { console.error('Refused: the command must name --code and --spec. Nothing was signed.'); process.exit(2); }
const self = crypto.createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex');
console.log(`This program's sha256: ${self}`);
console.log(`Base commit: ${argOf('--base')}`);
const specRaw = fs.readFileSync(path.join(code, specRel));
console.log(`You are signing: ${JSON.parse(specRaw).title}`);
console.log(`  spec file sha256: ${crypto.createHash('sha256').update(specRaw).digest('hex')}`);
console.log(`  with key: ${expected}`);
let plain;
let priv;
try { priv = crypto.createPrivateKey({ key: pem, passphrase: askPassphrase() }); }
catch { console.error('Refused: the passphrase is wrong or the key file is damaged. Nothing was signed.'); process.exit(2); }
if (priv.asymmetricKeyType !== 'ed25519') { console.error('Refused: this is not an Ed25519 key. Nothing was signed.'); process.exit(2); }
const keyId = crypto.createHash('sha256').update(crypto.createPublicKey(priv).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
if (keyId !== expected) { console.error(`Refused: this key is ${keyId}, and the command names ${expected}. Nothing was signed.`); process.exit(2); }
plain = priv.export({ type: 'pkcs8', format: 'pem' });

const hit = (p) => typeof p === 'string' && path.resolve(p) === VIRTUAL;
const under = (p) => typeof p === 'string' && path.resolve(p) === VIEW;
const { readFileSync, existsSync, statSync, mkdirSync, accessSync } = fs;
// The engine must never generate a key here: any attempt to write under the view stops the run.
const { openSync, writeFileSync } = fs;
const refuseWrite = (p) => { if (typeof p === 'string' && path.resolve(p).startsWith(VIEW + path.sep)) { console.error('Refused: something tried to write a key file. Nothing was signed.'); process.exit(2); } };
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
