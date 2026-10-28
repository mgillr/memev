// Loopback operator stub for setup-session tests.
import crypto from 'node:crypto';
import net from 'node:net';

export function makeOperatorKeys() {
  const ed = crypto.generateKeyPairSync('ed25519');
  const rawPub = ed.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const fingerprint = crypto.createHash('sha256').update(rawPub).digest('hex');
  return { publicKey: ed.publicKey, privateKey: ed.privateKey, rawPub, fingerprint };
}

const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');

function x25519RawPub(keyObj) {
  return keyObj.export({ type: 'spki', format: 'der' }).subarray(-32);
}

function x25519PubFromRaw(raw) {
  return crypto.createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

function x25519Shared(myPrivKeyObj, theirPubRaw) {
  const theirPub = x25519PubFromRaw(theirPubRaw);
  return crypto.diffieHellman({ privateKey: myPrivKeyObj, publicKey: theirPub });
}

export class OperatorStub {
  constructor({ sid, secret, host = '127.0.0.1', port, minutes, faults = {}, keys = null }) {
    this.sid = sid;
    this.secret = secret;
    this.host = host;
    this.port = port;
    this.minutes = minutes;
    this.faults = faults;
    this.keys = keys || makeOperatorKeys();
    this.server = null;
    this.sock = null;
    this.c2oKey = null;
    this.o2cKey = null;
    this.c2oN = 0;
    this.o2cN = 0;
    this._buf = Buffer.alloc(0);
    this._results = [];
    this._resultCbs = [];
    this._usedSids = new Set();
    this._hsDone = false;
    this._pending = null;
    this._cmdId = 0;
    this.closed = false;
    this._handshakeP = null;
    this._handshakeErr = null;
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((sock) => {
        this.sock = sock;
        this._buf = Buffer.alloc(0);
        this._hsDone = false;
        this._pending = null;
        this.c2oN = 0;
        this.o2cN = 0;
        sock.on('data', (c) => this._onData(c));
        sock.on('error', () => {});
        sock.on('close', () => {});
        this._handshakeP = this._handshake().catch((e) => {
          this._handshakeErr = e;
          sock.destroy();
        });
      });
      this.server.listen(this.port, this.host, () => resolve());
      this.server.on('error', reject);
    });
  }

  get handshakeError() { return this._handshakeErr; }

  async _handshake() {
    const hello = await this._recvPlain();
    if (hello.type !== 'hello') throw new Error('stub: expected hello');
    if (this._usedSids.has(hello.sid)) throw new Error('stub: replayed sid');
    this._usedSids.add(hello.sid);

    const ecdhKp = crypto.generateKeyPairSync('x25519');
    const opub = x25519RawPub(ecdhKp.publicKey);
    const ononce = crypto.randomBytes(16);

    const edPub = this.faults.wrongKey ? makeOperatorKeys() : this.keys;
    const rawOpLong = edPub.rawPub;

    await this._sendPlain({
      type: 'welcome',
      opub: opub.toString('hex'),
      opub_long: rawOpLong.toString('hex'),
      ononce: ononce.toString('hex'),
    });

    const cpub = Buffer.from(hello.cpub, 'hex');
    const cnonce = Buffer.from(hello.cnonce, 'hex');
    const ti = `memev-setup-v1|${hello.sid}|${hello.host}|${hello.port}|${hello.cpub}|${opub.toString('hex')}|${hello.cnonce}|${ononce.toString('hex')}`;
    const transcript = crypto.createHash('sha256').update(ti).digest();

    const shared = x25519Shared(ecdhKp.privateKey, cpub);

    this.c2oKey = crypto.hkdfSync('sha256', shared, transcript, 'memev-setup-c2o', 32);
    this.o2cKey = crypto.hkdfSync('sha256', shared, transcript, 'memev-setup-o2c', 32);

    const proofMsg = await this._recvPlain();
    if (proofMsg.type !== 'proof') throw new Error('stub: expected proof');
    const expectedSecret = this.faults.wrongSecret ? 'ff'.repeat(16) : this.secret;
    const expected = crypto.createHmac('sha256', Buffer.from(expectedSecret, 'hex')).update(transcript).digest('hex');
    if (proofMsg.proof !== expected) throw new Error('stub: proof mismatch');

    const sig = crypto.sign(null, transcript, edPub.privateKey);
    await this._sendPlain({ type: 'auth', sig: sig.toString('hex') });

    this._hsDone = true;
  }

  sendCmd(argv) {
    if (!this._hsDone || this.closed) throw new Error('stub not ready');
    const id = ++this._cmdId;
    this.send({ kind: 'cmd', id, argv });
    return id;
  }

  sendFinish() { this.send({ kind: 'finish' }); }
  sendPing() { this.send({ kind: 'ping' }); }

  send(obj) {
    const pt = Buffer.from(JSON.stringify(obj), 'utf8');
    const nonce = Buffer.alloc(12);
    nonce.writeBigUInt64BE(BigInt(this.o2cN++), 4);
    const c = crypto.createCipheriv('aes-256-gcm', this.o2cKey, nonce);
    const ct = Buffer.concat([c.update(pt), c.final()]);
    const frame = Buffer.concat([ct, c.getAuthTag()]);
    const hdr = Buffer.alloc(4);
    hdr.writeUInt32BE(frame.length);
    this.sock.write(Buffer.concat([hdr, frame]));
  }

  waitForResult(id, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const existing = this._results.find((r) => r.id === id);
      if (existing) { resolve(existing); return; }
      const t = setTimeout(() => reject(new Error('timeout waiting for result')), timeout);
      this._resultCbs.push((r) => {
        if (r.id === id) { clearTimeout(t); resolve(r); }
      });
    });
  }

  _onData(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    this._pump();
  }

  _pump() {
    while (this._buf.length >= 4) {
      const len = this._buf.readUInt32BE(0);
      if (this._buf.length < 4 + len) return;
      const body = this._buf.subarray(4, 4 + len);
      this._buf = this._buf.subarray(4 + len);

      if (!this._hsDone) {
        if (!this._pending) return;
        try { this._pending.resolve(JSON.parse(body.toString('utf8'))); } catch {}
        this._pending = null;
      } else {
        const nonce = body.subarray(0, 12);
        const ct = body.subarray(12, body.length - 16);
        const tag = body.subarray(body.length - 16);
        const d = crypto.createDecipheriv('aes-256-gcm', this.c2oKey, nonce);
        d.setAuthTag(tag);
        let pt;
        try { pt = Buffer.concat([d.update(ct), d.final()]); } catch { return; }
        this.c2oN++;
        try {
          const msg = JSON.parse(pt.toString('utf8'));
          if (msg.kind === 'result') {
            this._results.push(msg);
            for (const cb of this._resultCbs) cb(msg);
          }
        } catch {}
      }
    }
  }

  _sendPlain(obj) {
    const payload = Buffer.from(JSON.stringify(obj), 'utf8');
    const hdr = Buffer.alloc(4);
    hdr.writeUInt32BE(payload.length);
    return new Promise((res, rej) => {
      this.sock.write(Buffer.concat([hdr, payload]), (e) => e ? rej(e) : res());
    });
  }

  _recvPlain() {
    return new Promise((resolve, reject) => {
      this._pending = { resolve, reject };
      this._pump();
    });
  }

  close() {
    this.closed = true;
    this.sock?.destroy();
    this.server?.close();
  }
}
