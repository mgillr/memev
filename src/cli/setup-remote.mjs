// Customer-side remote setup session: foreground, allowlisted, logged, revocable.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseCode, SetupChannel } from '../engine/setup-channel.mjs';
import { PKG, STATE, config, out } from './common.mjs';
import { detect } from './clients.mjs';

const IDLE_MS = 300_000;
const CMD_TIMEOUT_MS = 120_000;

const ALLOW = [
  { cmd: 'doctor', args: [] },
  { cmd: 'status', args: [] },
  { cmd: 'deployment', args: ['show'] },
  { cmd: 'deployment', args: ['set', '<mode>'] },
  { cmd: 'license', args: ['status'] },
  { cmd: 'license', args: ['install', '<file>'] },
  { cmd: 'devices', args: ['list'] },
  { cmd: 'connect', args: ['<app>', '...'] },
  { cmd: 'ready', args: [] },
  { cmd: 'setup', args: ['remote', 'log'] },
  { cmd: 'setup', args: ['remote', 'log', '<sid>'] },
];

export function checkAllowlist(argv, root) {
  if (!Array.isArray(argv) || argv.length === 0) return { ok: false, reason: 'empty command' };
  for (const a of argv) {
    if (typeof a !== 'string' || a.startsWith('-'))
      return { ok: false, reason: `flags are not allowed: ${a}` };
  }
  const cmd = argv[0];
  const rest = argv.slice(1);

  if (cmd === 'doctor' && rest.length === 0) return { ok: true };
  if (cmd === 'status' && rest.length === 0) return { ok: true };
  if (cmd === 'deployment') {
    if (rest[0] === 'show' && rest.length === 1) return { ok: true };
    if (rest[0] === 'set' && rest.length === 2) {
      if (rest[1] !== 'local' && rest[1] !== 'container')
        return { ok: false, reason: `deployment mode must be local or container, got ${rest[1]}` };
      return { ok: true };
    }
    return { ok: false, reason: `deployment: unknown subcommand ${rest[0] || '(none)'}` };
  }
  if (cmd === 'license') {
    if (rest[0] === 'status' && rest.length === 1) return { ok: true };
    if (rest[0] === 'install' && rest.length === 2) {
      const p = path.resolve(root, rest[1]);
      const rootResolved = path.resolve(root);
      if (!p.startsWith(rootResolved + path.sep) && p !== rootResolved)
        return { ok: false, reason: `license file escapes vault root: ${rest[1]}` };
      return { ok: true };
    }
    return { ok: false, reason: `license: unknown subcommand ${rest[0] || '(none)'}` };
  }
  if (cmd === 'devices' && rest[0] === 'list' && rest.length === 1) return { ok: true };
  // the setup screen sends the apps the person ticked: each must be named, found and supported
  if (cmd === 'connect' && rest.length >= 1) {
    if (rest.includes('all'))
      return { ok: false, reason: 'connect: "all" is not allowed, name the apps' };
    const apps = detect();
    for (const id of rest) {
      const app = apps.find((a) => a.id === id);
      if (!app)
        return { ok: false, reason: `connect: unknown app ${id}` };
      if (!app.found || app.supported === false)
        return { ok: false, reason: `connect: app ${id} is not found and supported on this install` };
    }
    return { ok: true };
  }
  if (cmd === 'ready' && rest.length === 0) return { ok: true };
  if (cmd === 'setup') {
    if (rest[0] === 'remote' && rest[1] === 'log') {
      if (rest.length === 2) return { ok: true };
      if (rest.length === 3) {
        if (!/^[0-9a-f]{16}$/.test(rest[2]))
          return { ok: false, reason: `setup remote log: bad session id ${rest[2]}` };
        return { ok: true };
      }
    }
    return { ok: false, reason: `setup: only "setup remote log" is allowed` };
  }
  return { ok: false, reason: `command not in allowlist: ${cmd}` };
}

export function sessionDir(root, sid) {
  return path.join(root, '.memev', 'setup-sessions');
}

export function logPath(root, sid) {
  return path.join(sessionDir(root), `${sid}.log`);
}

export function statusPath(root, sid) {
  return path.join(sessionDir(root), `${sid}.status`);
}

export function appendLog(root, sid, entry) {
  const dir = sessionDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const lp = logPath(root, sid);
  let prev = '0'.repeat(64);
  if (fs.existsSync(lp)) {
    const lines = fs.readFileSync(lp, 'utf8').trim().split('\n');
    if (lines.length > 0 && lines[lines.length - 1]) {
      prev = crypto.createHash('sha256').update(lines[lines.length - 1]).digest('hex');
    }
  }
  const line = JSON.stringify({ ...entry, prev });
  fs.appendFileSync(lp, line + '\n');
  return line;
}

export function verifyChain(root, sid) {
  const lp = logPath(root, sid);
  if (!fs.existsSync(lp)) return { ok: false, reason: 'no log found' };
  const lines = fs.readFileSync(lp, 'utf8').trim().split('\n').filter(Boolean);
  let prev = '0'.repeat(64);
  for (let i = 0; i < lines.length; i++) {
    let obj;
    try { obj = JSON.parse(lines[i]); } catch { return { ok: false, reason: `line ${i + 1} is not valid JSON` }; }
    if (obj.prev !== prev) return { ok: false, reason: `chain broken at line ${i + 1}` };
    prev = crypto.createHash('sha256').update(lines[i]).digest('hex');
  }
  return { ok: true, count: lines.length };
}

export function redact(obj, secret) {
  const s = JSON.stringify(obj);
  if (!secret) return s;
  return s.split(secret).join('***');
}

export function isMemevSetupPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    const cl = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    return cl.includes('memev') && cl.includes('setup') && cl.includes('remote');
  } catch {
    return false;
  }
}

export class Session {
  constructor({ root, code, clock = Date, outStream = process.stdout, execute = null }) {
    this.root = root;
    this.code = code;
    this.clock = clock;
    this.outStream = outStream;
    this.execute = execute || ((argv) => this._defaultExecute(argv));
    this.channel = null;
    this.startedAt = null;
    this.deadline = null;
    this.lastActivity = null;
    this.revoked = false;
    this.done = false;
    this.cmdId = 0;
    this._pendingResults = new Map();
    this._revPoll = null;
    this._inProgress = null;
  }

  _now() {
    return typeof this.clock.now === 'function' ? this.clock.now() : Date.now();
  }

  async start() {
    const { sid, host, port, secret, fingerprint, minutes } = this.code;
    const cfg = config(this.root);
    const maxMin = cfg.setup?.session_max_minutes;
    let effMax = 60;
    if (maxMin != null && Number.isInteger(maxMin) && maxMin > 0) {
      if (maxMin > 240) {
        this._out(`setup.session_max_minutes ${maxMin} is above 240; using 240`);
        effMax = 240;
      } else {
        effMax = maxMin;
      }
    }
    const limit = Math.min(minutes, effMax);

    const lp = logPath(this.root, sid);
    if (fs.existsSync(lp)) {
      this._out(`setup session ${sid} was already used; the code is one-time`);
      return { ok: false, reason: 'setup code already used (one-time)' };
    }

    const dir = sessionDir(this.root);
    fs.mkdirSync(dir, { recursive: true });
    const sp = statusPath(this.root, sid);
    fs.writeFileSync(sp, JSON.stringify({ pid: process.pid, sid, startedAt: new Date().toISOString() }));

    this.startedAt = this._now();
    this.deadline = this.startedAt + limit * 60_000;
    this.lastActivity = this.startedAt;

    this.channel = new SetupChannel({ host, port, sid, secret, fingerprint, clock: this.clock });
    this.channel.on('message', (msg) => this._onMessage(msg));
    this.channel.on('close', () => this._finish('connection closed'));
    this.channel.on('error', (e) => {
      this._out(`session ended: ${e.message}`);
      this._log({ kind: 'end', reason: e.message });
      this._finish(e.message);
    });

    this._out(`setup session ${sid} starting to ${host}:${port} (limit ${limit} min)`);
    this._log({ kind: 'start', host, port, limit });

    try {
      await this.channel.connect();
    } catch (e) {
      this._out(`handshake failed: ${e.message}`);
      this._log({ kind: 'refusal', reason: `handshake: ${e.message}` });
      this._cleanup();
      return { ok: false, reason: e.message };
    }

    if (this.done) return { ok: false, reason: 'session ended during handshake' };

    this._out(`setup session ${sid} connected; waiting for operator commands`);
    this._log({ kind: 'connected' });

    this._revPoll = setInterval(() => this._checkRevoke(), 500);
    this._deadlineTimer = setInterval(() => this._checkDeadline(), 1000);

    await new Promise((resolve) => {
      this._resolve = resolve;
    });

    this._cleanup();
    return { ok: true };
  }

  _checkDeadline() {
    if (this.done) return;
    const now = this._now();
    if (now >= this.deadline) {
      this._out('session expired: time limit reached');
      this._log({ kind: 'end', reason: 'time limit' });
      this._finish('time limit');
      return;
    }
    if (now - this.lastActivity > IDLE_MS) {
      this._out('session ended: idle timeout');
      this._log({ kind: 'end', reason: 'idle timeout' });
      this._finish('idle timeout');
      return;
    }
  }

  _checkRevoke() {
    if (this.done) return;
    const sp = statusPath(this.root, this.code.sid);
    const rp = sp.replace('.status', '.revoked');
    if (fs.existsSync(rp)) {
      this._out('session revoked by customer');
      this._log({ kind: 'end', reason: 'revoked' });
      this._finish('revoked');
    }
  }

  tick() {
    this._checkDeadline();
    this._checkRevoke();
  }

  _onMessage(msg) {
    if (this.done) return;
    this.lastActivity = this._now();

    if (msg.kind === 'cmd') {
      this._handleCmd(msg);
    } else if (msg.kind === 'finish') {
      this._out('operator ended the session');
      this._log({ kind: 'end', reason: 'operator finish' });
      this._finish('operator finish');
    } else if (msg.kind === 'ping') {
      this.lastActivity = this._now();
    }
  }

  _handleCmd(msg) {
    const { id, argv } = msg;
    this.cmdId = Math.max(this.cmdId, id || 0);
    if (!Array.isArray(argv) || !argv.every((a) => typeof a === 'string')) {
      const shown = Array.isArray(argv) ? argv.join(' ') : String(argv);
      this._out(`refused: command must be a list of words`);
      this._log({ kind: 'refusal', id, argv: shown, reason: 'command must be a list of words' });
      try { this.channel.send({ kind: 'result', id, ok: false, code: 1, out: 'refused: command must be a list of words' }); } catch {}
      return;
    }
    const check = checkAllowlist(argv, this.root);
    if (!check.ok) {
      this._out(`refused: ${check.reason}`);
      this._log({ kind: 'refusal', id, argv: argv.join(' '), reason: check.reason });
      try { this.channel.send({ kind: 'result', id, ok: false, code: 1, out: `refused: ${check.reason}` }); } catch {}
      return;
    }

    this._out(`running: ${argv.join(' ')}`);
    this._log({ kind: 'request', id, argv: argv.join(' ') });

    this._inProgress = id;
    const run = this.execute(argv);
    const p = (typeof run === 'object' && run !== null && typeof run.then === 'function') ? run : Promise.resolve(run);
    p.then((res) => {
      this._inProgress = null;
      if (this.done) return;
      const outStr = typeof res.out === 'string' ? res.out : JSON.stringify(res.out || '');
      this._out(`result: ${res.ok ? 'ok' : 'failed'} (code ${res.code})`);
      this._log({ kind: 'result', id, ok: res.ok, code: res.code });
      try { this.channel.send({ kind: 'result', id, ok: res.ok, code: res.code, out: outStr.slice(0, 64000) }); } catch {}
    }).catch((e) => {
      this._inProgress = null;
      if (this.done) return;
      this._out(`result: failed (${e.message})`);
      this._log({ kind: 'result', id, ok: false, code: 1 });
      try { this.channel.send({ kind: 'result', id, ok: false, code: 1, out: e.message }); } catch {}
    });
  }

  _defaultExecute(argv) {
    const bin = path.join(PKG, 'bin', 'memev.mjs');
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [bin, ...argv], { windowsHide: true,
        env: { ...process.env, MEMEV_ROOT: this.root },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this._child = child;
      let out = '';
      const timer = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch {}
      }, CMD_TIMEOUT_MS);
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { out += d; });
      child.on('close', (code) => {
        clearTimeout(timer);
        this._child = null;
        resolve({ ok: code === 0, code: code ?? 1, out });
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        this._child = null;
        resolve({ ok: false, code: 1, out: e.message });
      });
    });
  }

  revoke() {
    if (this.done) return;
    this.revoked = true;
    this._out('session revoked');
    this._log({ kind: 'end', reason: 'revoked' });
    this._finish('revoked');
  }

  _finish(reason) {
    if (this.done) return;
    this.done = true;
    if (this._revPoll) clearInterval(this._revPoll);
    if (this._deadlineTimer) clearInterval(this._deadlineTimer);
    if (this._child) {
      try { this._child.kill('SIGTERM'); } catch {}
      this._child = null;
    }
    if (this.channel) {
      try { if (!this.channel.closed) this.channel.close(); } catch {}
    }
    this.channel?.wipe();
    this._cleanup();
    this._resolve?.();
  }

  _cleanup() {
    const sp = statusPath(this.root, this.code.sid);
    try { fs.unlinkSync(sp); } catch {}
    const rp = sp.replace('.status', '.revoked');
    try { fs.unlinkSync(rp); } catch {}
  }

  _out(msg) {
    this.outStream.write(msg + '\n');
  }

  _log(entry) {
    const line = appendLog(this.root, this.code.sid, {
      ts: new Date(this._now()).toISOString(),
      sid: this.code.sid,
      ...entry,
    });
    const redacted = redact(line, this.code.secret);
    this.outStream.write(redacted + '\n');
  }
}

export async function command(cmd, pos, flags, ctx) {
  const sub = pos[0];
  if (sub !== 'remote') {
    out.info('usage: memev setup remote --code <setup-code>');
    return 1;
  }
  const root = ctx.root || STATE;
  if (flags.code) {
    const codeStr = flags.code;
    const parsed = parseCode(codeStr);
    if (!parsed) { out.bad('invalid setup code'); return 1; }
    const session = new Session({ root, code: parsed });
    const onSigint = () => session.revoke();
    process.on('SIGINT', onSigint);
    const res = await session.start();
    process.removeListener('SIGINT', onSigint);
    return res.ok ? 0 : 1;
  }
  if (pos[1] === 'stop') {
    const dir = sessionDir(root);
    if (!fs.existsSync(dir)) { out.info('no active setup session'); return 1; }
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.status'));
    if (files.length === 0) { out.info('no active setup session'); return 1; }
    for (const f of files) {
      const sid = f.replace('.status', '');
      const sp = path.join(dir, f);
      const rp = sp.replace('.status', '.revoked');
      fs.writeFileSync(rp, 'revoked');
      let st = null;
      try { st = JSON.parse(fs.readFileSync(sp, 'utf8')); } catch {}
      if (st && st.pid && isMemevSetupPid(st.pid)) {
        try { process.kill(st.pid, 'SIGINT'); } catch {}
      } else {
        try { fs.unlinkSync(sp); } catch {}
      }
      out.info(`setup session ${sid} stop requested`);
    }
    return 0;
  }
  if (pos[1] === 'log') {
    const sid = pos[2];
    if (sid) {
      const v = verifyChain(root, sid);
      if (!v.ok) { out.bad(v.reason); return 1; }
      const lines = fs.readFileSync(logPath(root, sid), 'utf8').trim().split('\n').filter(Boolean);
      for (const l of lines) out.info(l);
      out.info(`chain intact, ${v.count} entries`);
      return 0;
    }
    const dir = sessionDir(root);
    if (!fs.existsSync(dir)) { out.info('no setup sessions'); return 0; }
    const logs = fs.readdirSync(dir).filter((f) => f.endsWith('.log'));
    if (logs.length === 0) { out.info('no setup sessions'); return 0; }
    for (const f of logs) {
      const s = f.replace('.log', '');
      const v = verifyChain(root, s);
      if (!v.ok) { out.bad(`${s}: ${v.reason}`); continue; }
      const lines = fs.readFileSync(logPath(root, s), 'utf8').trim().split('\n').filter(Boolean);
      for (const l of lines) out.info(l);
      out.info(`${s}: chain intact, ${v.count} entries`);
    }
    return 0;
  }
  out.info('usage: memev setup remote --code <setup-code>');
  out.info('         memev setup remote stop');
  out.info('         memev setup remote log [<session-id>]');
  return 1;
}
