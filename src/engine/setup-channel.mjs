// Outbound setup channel: mutual-auth handshake over node:crypto primitives,
// then an AES-256-GCM encrypted frame channel.
import crypto from 'node:crypto';
import net from 'node:net';

const VERSION = 1;
const MAX_FRAME = 1024 * 1024;

export function parseCode(code) {
  if (typeof code !== 'string') return null;
  const parts = code.split(':');
  if (parts.length !== 7) return null;
  const [prefix, sid, secret, fingerprint, host, portStr, minutesStr] = parts;
  if (prefix !== 'memev-setup-v1') return null;
  if (!/^[0-9a-f]{16}$/.test(sid)) return null;
  if (!/^[0-9a-f]{32}$/.test(secret)) return null;
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) return null;
  if (!host) return null;
  const port = Number(portStr);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const minutes = Number(minutesStr);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) return null;
  return { sid, secret, fingerprint, host, port, minutes };
}

export function makeCode({ sid, secret, fingerprint, host, port, minutes }) {
  return `memev-setup-v1:${sid}:${secret}:${fingerprint}:${host}:${port}:${minutes}`;
}

const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');

function x25519RawPub(keyObj) {
  return keyObj.export({ type: 'spki', format: 'der' }).subarray(-32);
}

function x25519RawPriv(keyObj) {
  return keyObj.export({ type: 'pkcs8', format: 'der' }).subarray(-32);
}

function x25519PubFromRaw(raw) {
  return crypto.createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

function x25519Shared(myPrivKeyObj, theirPubRaw) {
  const theirPub = x25519PubFromRaw(theirPubRaw);
  return crypto.diffieHellman({ privateKey: myPrivKeyObj, publicKey: theirPub });
}

function deriveKeys(shared, transcript, info) {
  return Buffer.from(crypto.hkdfSync('sha256', shared, transcript, info, 32));
}

function gcmNonce(counter) {
  const b = Buffer.alloc(12);
  b.writeBigUInt64BE(BigInt(counter), 4);
  return b;
}

export class SetupChannel {
  constructor({ host, port, sid, secret, fingerprint, clock = Date }) {
    this.host = host;
    this.port = port;
    this.sid = sid;
    this.secret = secret;
    this.fingerprint = fingerprint;
    this.clock = clock;
    this.sock = null;
    this.c2oKey = null;
    this.o2cKey = null;
    this.c2oN = 0;
    this.o2cN = 0;
    this.closed = false;
    this._buf = Buffer.alloc(0);
    this._h = { message: [], close: [], error: [] };
    this._hsDone = false;
    this._pending = null;
  }

  on(ev, cb) { (this._h[ev] ||= []).push(cb); }
  _emit(ev, ...a) { for (const cb of this._h[ev] || []) cb(...a); }

  connect() {
    return new Promise((resolve, reject) => {
      this.sock = net.connect({ host: this.host, port: this.port }, () => {
        this._handshake().then(resolve, reject);
      });
      this.sock.on('data', (c) => this._onData(c));
      this.sock.on('error', (e) => {
        if (!this._hsDone) reject(e);
        else this._emit('error', e);
      });
      this.sock.on('close', () => {
        this.closed = true;
        if (!this._hsDone) reject(new Error('connection closed during handshake'));
        this._emit('close');
      });
    });
  }

  async _handshake() {
    const kp = crypto.generateKeyPairSync('x25519');
    const cpub = x25519RawPub(kp.publicKey);
    const cnonce = crypto.randomBytes(16);

    await this._sendPlain({
      type: 'hello', v: VERSION, sid: this.sid,
      host: this.host, port: this.port,
      cpub: cpub.toString('hex'), cnonce: cnonce.toString('hex'),
    });

    const w = await this._recvPlain();
    if (w.type !== 'welcome') throw new Error('handshake: expected welcome');
    const opub = Buffer.from(w.opub, 'hex');
    const opubLong = Buffer.from(w.opub_long, 'hex');
    const ononce = Buffer.from(w.ononce, 'hex');

    const ti = `memev-setup-v1|${this.sid}|${this.host}|${this.port}|${cpub.toString('hex')}|${opub.toString('hex')}|${cnonce.toString('hex')}|${ononce.toString('hex')}`;
    const transcript = crypto.createHash('sha256').update(ti).digest();

    const shared = x25519Shared(kp.privateKey, opub);
    this.c2oKey = deriveKeys(shared, transcript, 'memev-setup-c2o');
    this.o2cKey = deriveKeys(shared, transcript, 'memev-setup-o2c');

    const proof = crypto.createHmac('sha256', Buffer.from(this.secret, 'hex')).update(transcript).digest();
    await this._sendPlain({ type: 'proof', proof: proof.toString('hex') });

    const auth = await this._recvPlain();
    if (auth.type !== 'auth') throw new Error('handshake: expected auth');

    const fp = crypto.createHash('sha256').update(opubLong).digest('hex');
    if (fp !== this.fingerprint) throw new Error('handshake: operator key mismatch');
    const ok = crypto.verify(null, transcript, {
      key: Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        opubLong,
      ]),
      format: 'der', type: 'spki',
    }, Buffer.from(auth.sig, 'hex'));
    if (!ok) throw new Error('handshake: operator signature invalid');

    this._hsDone = true;
  }

  async _sendPlain(obj) {
    const payload = Buffer.from(JSON.stringify(obj), 'utf8');
    const hdr = Buffer.alloc(4);
    hdr.writeUInt32BE(payload.length);
    await this._write(Buffer.concat([hdr, payload]));
  }

  _recvPlain() {
    return new Promise((resolve, reject) => {
      this._pending = { resolve, reject, plain: true };
      this._pump();
    });
  }

  send(obj) {
    if (!this._hsDone || this.closed) throw new Error('channel not ready');
    const pt = Buffer.from(JSON.stringify(obj), 'utf8');
    const nonce = gcmNonce(this.c2oN++);
    const c = crypto.createCipheriv('aes-256-gcm', this.c2oKey, nonce);
    const ct = Buffer.concat([c.update(pt), c.final()]);
    const frame = Buffer.concat([ct, c.getAuthTag()]);
    const hdr = Buffer.alloc(4);
    hdr.writeUInt32BE(frame.length);
    this.sock.write(Buffer.concat([hdr, frame]));
  }

  _onData(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    this._pump();
  }

  _pump() {
    while (this._buf.length >= 4) {
      const len = this._buf.readUInt32BE(0);
      if (len > MAX_FRAME) { this._fail('frame too large'); return; }
      if (this._buf.length < 4 + len) return;
      const body = this._buf.subarray(4, 4 + len);
      this._buf = this._buf.subarray(4 + len);

      if (!this._hsDone) {
        if (!this._pending || !this._pending.plain) { this._fail('unexpected frame'); return; }
        try {
          this._pending.resolve(JSON.parse(body.toString('utf8')));
        } catch { this._fail('bad handshake frame'); return; }
        this._pending = null;
      } else {
        const ct = body.subarray(0, body.length - 16);
        const tag = body.subarray(body.length - 16);
        const nonce = gcmNonce(this.o2cN);
        const d = crypto.createDecipheriv('aes-256-gcm', this.o2cKey, nonce);
        d.setAuthTag(tag);
        let pt;
        try {
          pt = Buffer.concat([d.update(ct), d.final()]);
        } catch { this._fail('frame auth failed'); return; }
        this.o2cN++;
        try {
          this._emit('message', JSON.parse(pt.toString('utf8')));
        } catch { /* ignore bad json */ }
      }
    }
  }

  _fail(msg) {
    this.closed = true;
    this.sock?.destroy();
    this._emit('error', new Error(msg));
    this._emit('close');
  }

  _write(buf) {
    return new Promise((res, rej) => {
      this.sock.write(buf, (e) => e ? rej(e) : res());
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.sock?.end();
    this.sock?.destroy();
    this.wipe();
  }

  wipe() {
    if (this.c2oKey) { this.c2oKey.fill(0); this.c2oKey = null; }
    if (this.o2cKey) { this.o2cKey.fill(0); this.o2cKey = null; }
    this.secret = null;
  }
}
