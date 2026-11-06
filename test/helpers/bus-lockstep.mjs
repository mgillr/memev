// Runs one random history of bus calls against two bus modules in two folders with the same clock, and compares every
// answer byte for byte, plus what each left on disk. The reference is test/fixtures/bus-main-oracle.mjs, a copy of the bus
// from before it kept an index. Used by bus-oracle.test.mjs, which also proves the comparison can fail.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mock } from 'node:test';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BUS_SRC = path.resolve(HERE, '../../src/engine/bus.mjs');

export function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const HOST = { id: 'dev_host00000000', kind: 'host', label: 'hostpc', status: 'active' };
const LAPTOP = { id: 'dev_laptop000000', kind: 'remote-computer', label: 'laptop', status: 'active' };
const CLOUD = { id: 'dev_cloud0000000', kind: 'cloud-connector', label: 'chatgpt', status: 'active' };
const OFFLINE = 'dev_offline00000';
const OFFLINE2 = 'dev_aheadclock00';
const ALL = [HOST, LAPTOP, CLOUD];
const devices = () => ({ hostId: HOST.id, get: (id) => ALL.find((d) => d.id === id) || null, list: () => ALL });
const ID = { id: 'test', agent: 'test', scopes: ['read', 'write'], paths: ['**'] };
const TYPES = ['status', 'status', 'status', 'question', 'answer', 'finding', 'verdict', 'task', 'task', 'claim', 'restate', 'hold', 'ack', 'review'];

/** A module on disk with its relative imports made absolute, so a changed copy can live anywhere. */
export function moduleCopy(dir, name, text) {
  const engine = pathToFileURL(path.dirname(BUS_SRC)).href;
  const f = path.join(dir, name);
  fs.writeFileSync(f, text.replace(/from '\.\/([a-z0-9-]+\.mjs)'/g, (_, m) => `from '${engine}/${m}'`));
  return pathToFileURL(f).href;
}

const clean = (r) => JSON.stringify(r, (k, v) => (v instanceof Map || v instanceof Set ? [...v] : v));
function attempt(fn) {
  try { return { ok: clean(fn()) }; } catch (e) { return { error: `${e.code || e.name}: ${e.message}` }; }
}
async function attemptAsync(fn) {
  try { return { ok: clean(await fn()) }; } catch (e) { return { error: `${e.code || e.name}: ${e.message}` }; }
}

function readTree(root, sub) {
  const out = {};
  const d = path.join(root, 'bus', sub);
  let names = []; try { names = fs.readdirSync(d, { recursive: true }).map(String); } catch {}
  for (const n of names) { const f = path.join(d, n); if (fs.statSync(f).isFile()) out[n.split(path.sep).join('/')] = fs.readFileSync(f, 'utf8'); }
  return out;
}
const parsedTree = (t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, JSON.parse(v)]));
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);

/**
 * One history. A and B are Bus classes. Returns null when every answer and every file agreed, or a description of the first
 * difference. compareLog 'bytes' wants the same files; 'lines' wants the same lines whichever file holds them.
 */
export async function lockstep({ A, B, seed, steps = 120, compareLog = 'bytes', optionsA = {}, optionsB = {} }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-bus-lockstep-'));
  const roots = [path.join(base, 'a'), path.join(base, 'b')];
  const r = prng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  let at = Date.parse('2026-03-30T12:00:00.000Z');
  mock.timers.enable({ apis: ['Date'], now: at });
  try {
    const commits = [[], []];
    const make = (i) => new (i === 0 ? A : B)({ root: roots[i], devices: devices(), commit: (p) => commits[i].push(p), config: i === 0 ? optionsA : optionsB });
    const buses = [make(0), make(1)];
    for (const [i, b] of buses.entries()) { fs.mkdirSync(path.join(roots[i], 'bus', 'log'), { recursive: true }); b.ensure(HOST.id); }
    const ctxs = {
      codex: { identity: ID, client: 'codex', device: HOST },
      claude: { identity: ID, client: 'claude', device: HOST, local: true },
      cursor: { identity: ID, client: 'cursor', device: LAPTOP },
      gemini: { identity: ID, client: 'gemini', device: LAPTOP },
      chatgpt: { identity: ID, client: 'chatgpt', device: CLOUD },
      cli: { identity: ID, client: 'cli', device: HOST, cli: true, local: true },
      scoped: { identity: ID, client: 'scoped', device: HOST },
    };
    // a seat that sees only its own project
    for (const b of buses) b.register({ client: 'scoped', device: HOST, project: 'alpha' });
    const seatsNow = ['codex@hostpc', 'claude@hostpc', 'cursor@laptop', 'gemini@laptop'];
    const taskIds = [];
    // the same foreign bytes go to both folders
    const dseqs = { [OFFLINE]: 0, [OFFLINE2]: 0 };
    const foreign = (device, ts, extra = {}) => {
      dseqs[device] += 1;
      const msg = { id: `${device.slice(4, 12)}-${dseqs[device]}`, dseq: dseqs[device], ts, device, from: pick(['zed@pc-c', 'codex@hostpc', 'yan@pc-c']), operator: r() < 0.2, to: pick(['all', 'all', 'operator', ...seatsNow]), type: pick(TYPES), body: `offline ${dseqs[device]}`, ref: taskIds.length && r() < 0.4 ? pick(taskIds) : null, project: r() < 0.3 ? pick(['alpha', 'beta']) : null, ...extra };
      return `${JSON.stringify(msg)}\n`;
    };
    const both = (fn) => { for (const root of roots) fn(root); };
    const appendRaw = (device, text) => both((root) => fs.appendFileSync(path.join(root, 'bus', 'log', `${device}.jsonl`), text));

    const check = (label, a, b) => {
      if (JSON.stringify(a) !== JSON.stringify(b)) return `${label}\n  A: ${JSON.stringify(a).slice(0, 700)}\n  B: ${JSON.stringify(b).slice(0, 700)}`;
      return null;
    };
    const both2 = async (label, fn, isAsync = false) => {
      const ra = isAsync ? await attemptAsync(() => fn(buses[0])) : attempt(() => fn(buses[0]));
      const rb = isAsync ? await attemptAsync(() => fn(buses[1])) : attempt(() => fn(buses[1]));
      return { diff: check(label, ra, rb), a: ra };
    };

    for (let step = 0; step < steps; step++) {
      at += r() < 0.1 ? 0 : Math.floor(r() * 40000) + 1;
      // a month boundary now and then, so anything that rotates does
      if (r() < 0.01) at += 12 * 86400e3;
      mock.timers.setTime(at);
      const who = pick(['codex', 'claude', 'cursor', 'gemini', 'chatgpt', 'cli', 'scoped', 'scoped']);
      const ctx = ctxs[who];
      const seat = who === 'cli' || who === 'chatgpt' || who === 'scoped' || r() < 0.8 ? null : pick(seatsNow);
      const x = r() * 100;
      let label; let out;
      if (x < 34) {
        const type = pick(TYPES);
        const ref = ['claim', 'restate', 'verdict'].includes(type) && taskIds.length ? pick(taskIds) : type === 'ack' && taskIds.length ? pick(taskIds) : null;
        const args = { to: pick(['all', 'all', 'operator', ...seatsNow, 'nobody@nowhere']), type, body: r() < 0.05 ? 'x'.repeat(900) : `m${step} ${'é'.repeat(Math.floor(r() * 3))}`, ref, project: r() < 0.3 ? pick(['alpha', 'beta']) : null, seat, release: type === 'hold' && r() < 0.4, check: type === 'status' && r() < 0.1 };
        label = `send ${JSON.stringify(args)} as ${who}`;
        out = await both2(label, (b) => b.send(ctx, args));
        if (out.a.ok && type === 'task') taskIds.push(JSON.parse(out.a.ok).id);
      } else if (x < 58) {
        const args = { seat: r() < 0.7 ? null : pick(seatsNow), peek: r() < 0.4, ...(r() < 0.6 ? { capped: true } : {}), ...(r() < 0.3 ? { limit: pick([1, 3, 8, 50, 500]) } : {}) };
        label = `unread ${JSON.stringify(args)} as ${who}`;
        out = await both2(label, (b) => b.unread(ctx, args));
      } else if (x < 66) { label = 'roster'; out = await both2(label, (b) => b.roster({ at })); }
      else if (x < 72) { label = `tasks as ${who}`; const open = r() < 0.5; out = await both2(label, (b) => b.tasks(ctx, { open })); }
      else if (x < 76) { label = 'all'; out = await both2(label, (b) => b.all()); }
      else if (x < 79) { const args = { seq: pick([0, 1, 5, 20, 3.5, 'x', -2, 1e9]), limit: pick([1, 5, 50]) }; label = `since ${JSON.stringify(args)}`; out = await both2(label, (b) => b.since(ctx, args)); }
      else if (x < 82) { const args = { n: pick([1, 5, 20, 50]), type: r() < 0.3 ? pick(TYPES) : null }; label = `tail ${JSON.stringify(args)}`; out = await both2(label, (b) => b.tail(ctx, args)); }
      else if (x < 83.5) { label = 'health'; out = await both2(label, (b) => b.health({ at })); }
      else if (x < 85) { const s = pick(seatsNow); label = `hold of ${s}`; out = await both2(label, (b) => b.holdOn(s)); }
      else if (x < 90) {
        // written while offline: an older time than what is already on the bus
        const device = r() < 0.7 ? OFFLINE : OFFLINE2;
        const ts = new Date(device === OFFLINE ? at - Math.floor(r() * 3600e3) : at + Math.floor(r() * 3600e3)).toISOString();
        label = `foreign line on ${device}`; appendRaw(device, foreign(device, ts));
      } else if (x < 91) { label = 'bad line'; appendRaw(OFFLINE, '{not json\n'); }
      else if (x < 91.6) {
        // a crash left half a line at the end of this computer's own file; the next message runs into it
        label = 'half a line on own file';
        both((root) => { const f = buses[roots.indexOf(root)]._activeFileForTest?.(HOST.id) || `${HOST.id}.jsonl`; fs.appendFileSync(path.join(root, 'bus', 'log', f), '{"id":"half'); });
      } else if (x < 92.2) {
        label = 'a line with its own seq, or a time that is not text';
        appendRaw(OFFLINE2, r() < 0.5 ? foreign(OFFLINE2, new Date(at).toISOString(), { seq: 7 }) : foreign(OFFLINE2, 1234));
      } else if (x < 93) {
        // sync rewrote a file: the lines keep their content, in another order
        label = 'file rewritten';
        both((root) => { const f = path.join(root, 'bus', 'log', `${OFFLINE}.jsonl`); if (fs.existsSync(f)) fs.writeFileSync(f, `${fs.readFileSync(f, 'utf8').trim().split('\n').reverse().join('\n')}\n`); });
      } else if (x < 95) {
        const s = pick(seatsNow); const n = `${s.split('@')[0]}2@${s.split('@')[1]}`;
        label = `rename ${s}`; out = await both2(label, (b) => b.renameSeat(s, n));
        if (out.a.ok) { seatsNow[seatsNow.indexOf(s)] = n; }
      } else if (x < 97) {
        const s = pick(seatsNow); label = `operator ${s}`; out = await both2(label, (b) => b.setOperator(s));
      } else if (x < 98) {
        label = 'transition'; const assignee = pick(seatsNow); out = await both2(label, (b) => b.postTransition({ project: 'alpha', task: 't1', from: 'a', to: 'b', assignee }));
      } else if (x < 98.5) {
        label = 'seat removed'; const s = pick(seatsNow); both((root) => { const f = path.join(root, 'bus', 'seats', `${s.replace('@', '~')}.json`); if (fs.existsSync(f)) { const rec = JSON.parse(fs.readFileSync(f, 'utf8')); fs.writeFileSync(f, JSON.stringify({ ...rec, removed: new Date(at).toISOString() })); } });
      } else if (x < 99) {
        label = 'check'; out = await both2(label, (b) => b.check(ctx, { timeout_s: 0, seat }), true);
      } else {
        // a restart: nothing in memory survives
        label = 'restart'; buses[0] = make(0); buses[1] = make(1);
      }
      if (out?.diff) return `seed ${seed} step ${step}: ${out.diff}`;
      const logs = [readTree(roots[0], 'log'), readTree(roots[1], 'log')];
      const logA = compareLog === 'bytes' ? logs[0] : Object.values(logs[0]).join('').split('\n').filter(Boolean).sort();
      const logB = compareLog === 'bytes' ? logs[1] : Object.values(logs[1]).join('').split('\n').filter(Boolean).sort();
      const d = check(`log after ${label}`, logA, logB)
        || check(`pulse after ${label}`, sortKeys(parsedTree(readTree(roots[0], 'pulse'))), sortKeys(parsedTree(readTree(roots[1], 'pulse'))))
        || check(`seats after ${label}`, readTree(roots[0], 'seats'), readTree(roots[1], 'seats'))
        || (compareLog === 'bytes' ? check(`commits after ${label}`, commits[0], commits[1]) : null);
      if (d) return `seed ${seed} step ${step}: ${d}`;
    }
    return null;
  } finally {
    mock.timers.reset();
    fs.rmSync(base, { recursive: true, force: true });
  }
}
