// SO-R-D: the installation runbook an AI app follows, checked against the real CLI. The nine sections
// are in the order the setup must happen; every command on the page is in memev help or the README
// install section; the verification steps name the machine-readable forms and the page states their
// fields; memev ready --json prints one object with each client's joined flag and the time of its
// first heartbeat; and the page names no client product and no version.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PKG, cleanup } from './helpers/tmp.mjs';
import { sandbox, mcpClient, BIN } from './helpers/cli.mjs';

const PAGE = fs.readFileSync(path.join(PKG, 'docs', 'INSTALL-FOR-AI.md'), 'utf8');
const README = fs.readFileSync(path.join(PKG, 'README.md'), 'utf8');
const CLIENTS = fs.readFileSync(path.join(PKG, 'docs', 'CLIENTS.md'), 'utf8');
const VERSION = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')).version;
const CMD = /^(memev|node|npm|npx|git|docker)\b/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const MEMORY = 'The nightly export reads the reporting replica, never the primary database.';
const ASK = 'which database does the nightly export read';
let sb; const running = []; const mcps = [];
afterEach(() => { for (const p of running.splice(0)) p.kill(); for (const m of mcps.splice(0)) m.close(); sb?.stop(); sb = null; });
after(cleanup);

// --- the page ---

const headings = () => [...PAGE.matchAll(/^## (.+)$/gm)].map((m) => m[1].toLowerCase());

function section(title) {
  const lines = PAGE.split('\n');
  const start = lines.findIndex((l) => l.toLowerCase().startsWith(`## ${title}`));
  assert.notEqual(start, -1, `no section ${title}`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (lines[i].startsWith('## ')) { end = i; break; }
  return lines.slice(start, end).join('\n');
}

// fenced code blocks out of the text (their backticks would desynchronize the inline-span pairing);
// the fenced lines come back as commands
function splitFences(text) {
  const fenced = []; const open = [];
  let inFence = false;
  for (const l of text.split('\n')) {
    if (/^\s*```/.test(l)) { inFence = !inFence; continue; }
    if (inFence) { if (l.trim()) fenced.push(l.trim()); } else open.push(l);
  }
  return { open: open.join('\n'), fenced };
}

function pageCommands() {
  const { open, fenced } = splitFences(PAGE);
  const cmds = new Set(fenced);
  for (const m of open.matchAll(/`([^`]+)`/g)) cmds.add(m[1].trim());
  return [...cmds].filter((c) => CMD.test(c));
}

// --- memev help and the README install section ---

function helpForms() {
  const sbx = sandbox();
  const forms = [];
  for (const line of sbx.run(['help']).out.split('\n')) {
    const m = /^  memev (.+)$/.exec(line);
    if (!m) continue;
    for (const part of m[1].split(/\s{2,}/)[0].split(' | ')) {
      const toks = part.trim().split(/\s+/);
      forms.push({
        base: ['memev', ...toks.filter((t) => !/^-/.test(t) && !/^[<[]/.test(t))],
        flags: new Set(toks.filter((t) => /^-/.test(t))),
        hasArg: toks.some((t) => /^[<[]/.test(t)),
      });
    }
  }
  return forms;
}

const GLOBAL_FLAGS = new Set(['--root', '--help', '-h']);
function inHelp(cmd, forms) {
  const toks = cmd.split(/\s+/);
  const flags = toks.filter((t) => /^-/.test(t));
  const words = toks.filter((t) => !/^-/.test(t) && !/^[<[]/.test(t));
  const placeholders = toks.filter((t) => /^[<[]/.test(t));
  return forms.some((f) =>
    f.base.length === words.length &&
    f.base.every((t, i) => t === words[i]) &&
    flags.every((fl) => f.flags.has(fl) || GLOBAL_FLAGS.has(fl)) &&
    (placeholders.length === 0 || f.hasArg));
}

function readmeCommands() {
  const lines = README.split('\n');
  const start = lines.findIndex((l) => /^## Install\b/.test(l));
  assert.notEqual(start, -1, 'README has an Install section');
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^## /.test(lines[i])) { end = i; break; }
  const { open, fenced } = splitFences(lines.slice(start, end).join('\n'));
  const cmds = new Set(fenced);
  for (const m of open.matchAll(/`([^`]+)`/g)) cmds.add(m[1].trim());
  return [...cmds].filter((c) => CMD.test(c));
}

const inReadme = (cmd, readme) => readme.some((r) => r === cmd || r.includes(cmd) || cmd.includes(r));

// --- the sandbox, like test/ready.test.mjs ---

function setup() {
  sb = sandbox();
  for (const d of ['.claude', '.cursor']) fs.mkdirSync(path.join(sb.home, d), { recursive: true });
  const r = sb.run(['init', '--port', String(sb.port), '--local-only']);
  assert.equal(r.code, 0, r.out + r.err);
}
// an app opens a session: its session-start hook sends the first heartbeat
const open = (client, session) => assert.equal(sb.hook('session-start', { session_id: session, source: 'startup' }, client, client === 'cursor' ? ['--format', 'cursor'] : []).code, 0);
async function app(client) { const m = mcpClient(sb, client); mcps.push(m); await m.request('initialize', { protocolVersion: '2025-06-18' }); return m; }
// memev ready --json in the background; `done` gives the exit code and the output
function readyJson(args) {
  const p = spawn(process.execPath, [BIN, 'ready', ...args, '--json'], { env: { ...sb.env, MEMEV_READY_POLL_MS: '100' } });
  running.push(p);
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  const done = new Promise((resolve) => p.on('close', (code) => resolve({ code, out })));
  return { done, out: () => out, kill: () => p.kill() };
}
const isTime = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));

// --- the tests ---

test('SO-R-D AC01: the runbook carries the nine sections in order, and the failure section carries the stop rules', () => {
  const heads = headings();
  const want = [
    'identify the operating system and runtime',
    'choose and explain the installation path',
    'ask permission before each privileged action',
    'install the pinned stable release',
    'verify the installed version and health',
    'run the minimal smoke test',
    'connect only the clients the user approved',
    'report exact results and limitations',
    'diagnose and recover or stop safely',
  ];
  let at = 0;
  for (const h of heads) { if (at < want.length && h.includes(want[at])) at++; }
  assert.equal(at, want.length, `missing or out of order from ${want[at] || 'the end'}; headings: ${heads.join(' | ')}`);
  const fail = section('on failure: diagnose and recover or stop safely').replace(/\s+/g, ' ');
  assert.match(fail, /never repeat a destructive command/i);
  assert.match(fail, /never report unverified success/i);
});

test('SO-R-D AC02: every command on the page is in memev help or a README install command', () => {
  const forms = helpForms();
  const readme = readmeCommands();
  const experimental = /not published yet|coming soon|experimental|preview|unsupported/i;
  const bad = [];
  for (const cmd of pageCommands()) {
    const line = PAGE.split('\n').find((l) => l.includes(cmd));
    if (inHelp(cmd, forms) || inReadme(cmd, readme) || (line && experimental.test(line))) continue;
    bad.push(cmd);
  }
  assert.deepEqual(bad, [], `not in memev help or the README install section: ${bad.join(', ')}`);
});

test('SO-R-D AC02: the verification steps name the machine-readable forms and the page states their fields', () => {
  for (const c of ['memev --version', 'memev doctor --json', 'memev ready --json']) assert.ok(PAGE.includes(`\`${c}\``), `the page must name \`${c}\``);
  assert.match(PAGE, /prints the installed version, one line/);
  for (const f of ['id', 'title', 'status', 'detail', 'fix']) assert.ok(PAGE.includes(`\`${f}\``), `the page must state the doctor field \`${f}\``);
  for (const f of ['ok', 'smoke', 'clients', 'name', 'joined', 'joinedAt']) assert.ok(PAGE.includes(`\`${f}\``), `the page must state the ready field \`${f}\``);
  assert.match(PAGE, /0 when ready/);
  assert.match(PAGE, /1 when it is not ready within the timeout/);
  assert.match(PAGE, /2 for a usage error/);
});

test('SO-R-D AC02: memev --version and memev doctor --json print the fields the page states', { timeout: 60000 }, () => {
  sb = sandbox();
  const r = sb.run(['init', '--port', String(sb.port), '--local-only']);
  assert.equal(r.code, 0, r.out + r.err);
  const v = sb.run(['--version']);
  assert.equal(v.code, 0);
  assert.equal(v.out.trim(), VERSION, 'one line: the installed version');
  const d = sb.run(['doctor', '--json']);
  assert.ok(d.code === 0 || d.code === 1, d.out + d.err);
  const checks = JSON.parse(d.out);
  assert.ok(Array.isArray(checks) && checks.length > 0, 'one JSON array of checks');
  for (const c of checks) {
    assert.equal(typeof c.id, 'string');
    assert.equal(typeof c.title, 'string');
    assert.ok(['ok', 'warn', 'fail'].includes(c.status), c.status);
    assert.equal(typeof c.detail, 'string');
    assert.ok(c.fix === null || (c.fix && typeof c.fix.desc === 'string' && typeof c.fix.destructive === 'boolean'));
  }
});

test('SO-R-D AC03: memev ready --json exits 2 on a usage error and prints no JSON', () => {
  sb = sandbox();
  const r = sb.run(['ready', '--timeout', 'abc', '--json']);
  assert.equal(r.code, 2, r.out + r.err);
  assert.doesNotMatch(r.out, /\{/);
  assert.match(r.err, /usage: memev ready/);
  const r2 = sb.run(['ready', '--timeout', '-5', '--json']);
  assert.equal(r2.code, 2, r2.out + r2.err);
});

test('SO-R-D AC03: memev ready --json exits 1 when not ready within the timeout, with each client joined true or false', { timeout: 60000 }, async () => {
  setup();
  open('cursor', 'so-rd-t1');
  const { code, out } = await readyJson(['--timeout', '1']).done;
  assert.equal(code, 1, out);
  const j = JSON.parse(out.trim());
  assert.equal(j.ok, false);
  assert.equal(j.smoke, false);
  assert.equal(j.clients.length, 2);
  const cursor = j.clients.find((c) => c.id === 'cursor');
  const cc = j.clients.find((c) => c.id === 'claude-code');
  assert.equal(cursor.joined, true);
  assert.ok(isTime(cursor.joinedAt), `joinedAt is a time: ${cursor.joinedAt}`);
  assert.equal(cc.joined, false);
  assert.equal(cc.joinedAt, null);
});

test('SO-R-D AC03: two clients that joined but never recalled each other leave smoke false', { timeout: 60000 }, async () => {
  setup();
  const cc = await app('claude-code'); const cu = await app('cursor');
  try {
    const saved = await cc.tool('memev_remember', { text: MEMORY, kind: 'decision', project: 'billing', force: true });
    assert.ok(!saved.isError, JSON.stringify(saved));
    const own = await cc.tool('memev_recall', { query: ASK, project: 'billing' });
    assert.match(JSON.stringify(own.structuredContent), /reporting replica/);
    open('claude-code', 'so-rd-n1');
    open('cursor', 'so-rd-n2');
    const { code, out } = await readyJson(['--timeout', '1']).done;
    assert.equal(code, 1, out);
    const j = JSON.parse(out.trim());
    assert.equal(j.ok, false);
    assert.equal(j.smoke, false);
    assert.ok(j.clients.every((c) => c.joined === true), out);
  } finally { await cc.close(); await cu.close(); }
});

test('SO-R-D AC03: memev ready --json sets smoke true only after two clients joined and a cross-client recall', { timeout: 60000 }, async () => {
  setup();
  const cc = await app('claude-code'); const cu = await app('cursor');
  try {
    const saved = await cc.tool('memev_remember', { text: MEMORY, kind: 'decision', project: 'billing', force: true });
    assert.ok(!saved.isError, JSON.stringify(saved));
    const own = await cc.tool('memev_recall', { query: ASK, project: 'billing' });
    assert.match(JSON.stringify(own.structuredContent), /reporting replica/);
    const r = readyJson(['--timeout', '30']);
    open('claude-code', 'so-rd-1');
    const early = await cu.tool('memev_recall', { query: ASK, project: 'billing' });
    assert.match(JSON.stringify(early.structuredContent), /reporting replica/);
    await new Promise((res) => setTimeout(res, 500));
    open('cursor', 'so-rd-2');
    const { code, out } = await r.done;
    assert.equal(code, 0, out);
    const j = JSON.parse(out.trim());
    assert.equal(j.ok, true);
    assert.equal(j.smoke, true);
    assert.equal(j.clients.length, 2);
    for (const c of j.clients) {
      assert.equal(typeof c.id, 'string');
      assert.equal(typeof c.name, 'string');
      assert.equal(c.joined, true);
      assert.ok(isTime(c.joinedAt), `joinedAt is a time: ${c.joinedAt}`);
    }
  } finally { await cc.close(); await cu.close(); }
});

test('SO-R-D AC04: the page names no client product, no version, and labels every experimental path', () => {
  const names = new Set();
  for (const m of CLIENTS.matchAll(/^\| ([^|]+) \|/gm)) {
    const n = m[1].trim();
    if (/^[A-Za-z]/.test(n) && !/^(app|client|name|mode)$/i.test(n)) names.add(n);
  }
  for (const m of CLIENTS.matchAll(/\[([^\]]+)\]\(clients\/[^)]+\)/g)) names.add(m[1].trim());
  const cloud = /Cloud apps \(([^)]+)\)/.exec(CLIENTS);
  if (cloud) for (const n of cloud[1].split(',')) if (/^[A-Za-z0-9.]+$/.test(n.trim())) names.add(n.trim());
  assert.ok(names.size >= 10, `expected at least 10 client names in CLIENTS.md, got ${names.size}`);
  for (const n of names) assert.doesNotMatch(PAGE, new RegExp(escapeRe(n), 'i'), `the page must not name ${n}`);
  assert.ok(PAGE.includes('CLIENTS.md'), 'the page links to docs/CLIENTS.md');
  assert.doesNotMatch(PAGE, new RegExp(escapeRe(VERSION)), 'the page must not pin a version');
  for (const l of PAGE.split('\n')) {
    if (/npx memev init/.test(l)) assert.match(l, /not published yet|coming soon|experimental|preview|unsupported/i, l);
    if (/\bWindows\b/.test(l)) assert.match(l, /preview|experimental|unsupported/i, l);
    if (/one-line installer/i.test(l)) assert.match(l, /coming soon|experimental|preview|unsupported/i, l);
  }
});

test('SO-R-D AC05: the page says the agent asks permission before privileged actions and never weakens local security controls', () => {
  const sec = section('ask permission before each privileged action');
  assert.match(sec, /ask/i);
  assert.match(sec, /before/i);
  assert.match(PAGE, /never weaken local security controls/i);
});
