// SPDX-License-Identifier: Apache-2.0
// The benchmark harness. It runs Memev's own code in this process: the vault, the HTTP routes the hooks and
// MCP clients call, and the hook commands themselves. The routes are reached through a stand-in for fetch
// that hands each request on the vault's loopback port straight to the server's request handler, so
// nothing listens and nothing goes over a network; any other request goes to the real fetch.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { install, clock } from './determinism.mjs';
import { seedVault, LEVELS } from './seed.mjs';
import { count } from './o200k.mjs';

export const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
export const QUERIES = path.join(REPO, 'bench', 'queries.json');
const CODE_PATHS = ['src', 'templates', 'vendor', 'bin', 'package.json'];

// ---- the code under test: this checkout, or the files of a commit extracted to a temporary folder
export function extract(repo, sha) {
  const present = execFileSync('git', ['-C', repo, 'ls-tree', '--name-only', sha], { encoding: 'utf8' }).split('\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `memev-bench-${sha.slice(0, 7)}-`));
  const tar = execFileSync('git', ['-C', repo, 'archive', '--format=tar', sha, '--', ...CODE_PATHS.filter((p) => present.includes(p))], { maxBuffer: 1 << 30 });
  execFileSync('tar', ['-x', '-C', dir], { input: tar, maxBuffer: 1 << 30 });
  return dir;
}

export function revParse(repo, ref) { return execFileSync('git', ['-C', repo, 'rev-parse', ref], { encoding: 'utf8' }).trim(); }

export async function loadCode(dir, sha) {
  const u = (p) => pathToFileURL(path.join(dir, p)).href;
  const [vault, http, card, clients, hooks, common] = await Promise.all(['src/engine/vault.mjs', 'src/server/http.mjs', 'src/engine/card.mjs', 'src/cli/clients.mjs', 'src/cli/hooks.mjs', 'src/cli/common.mjs'].map((p) => import(u(p))));
  return { dir, sha, Vault: vault.Vault, initVault: vault.initVault, createServer: http.createServer, PROTOCOL: card.PROTOCOL, INSTRUCTIONS: clients.INSTRUCTIONS, runHook: hooks.runHook, clientToken: common.clientToken };
}

// ---- requests to a vault's port go to its server's request handler, in this process
const ROUTES = new Map(); // port -> http.Server (never listening)
let realFetch = null;
function dispatch(server, u, init) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(init.body == null ? [] : [Buffer.from(String(init.body))]);
    const headers = { host: `127.0.0.1:${u.port}` };
    for (const [k, v] of new Headers(init.headers || {})) headers[k] = v;
    Object.assign(req, { method: String(init.method || 'GET').toUpperCase(), url: u.pathname + u.search, headers, socket: { remoteAddress: '127.0.0.1' } });
    const res = {
      headersSent: false, statusCode: 200, h: {},
      writeHead(code, h = {}) { this.statusCode = code; this.h = h; this.headersSent = true; return this; },
      end(body = '') { resolve(new Response([204, 304].includes(this.statusCode) ? null : body, { status: this.statusCode, headers: this.h })); },
    };
    try { server.emit('request', req, res); } catch (e) { reject(e); }
  });
}
function routeFetch() {
  if (realFetch) return;
  realFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => {
    const u = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    const server = ['127.0.0.1', 'localhost'].includes(u.hostname) ? ROUTES.get(u.port) : null;
    return server ? dispatch(server, u, init) : realFetch(input, init);
  };
}

/** Before anything else: repeatable clock and ids, a throwaway home, and the in-process routes. */
export function prepare() {
  install({ seed: 1 });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-bench-home-'));
  Object.assign(process.env, { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config'), MEMEV_CONFIG_DIR: path.join(home, '.config', 'memev'),
    MEMEV_NO_SERVICE: '1', MEMEV_NO_TUNNEL: '1', MEMEV_NO_BACKGROUND: '1', MEMEV_NO_DOWNLOAD: '1', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'bench', GIT_AUTHOR_EMAIL: 'bench@example.invalid', GIT_COMMITTER_NAME: 'bench', GIT_COMMITTER_EMAIL: 'bench@example.invalid' });
  delete process.env.MEMEV_PORT; delete process.env.MEMEV_ROOT; delete process.env.MEMEV_SESSION;
  routeFetch();
  return home;
}

let nextPort = 47100;
/** One vault served by one version of the code. */
export class Bench {
  constructor(code, root) { this.code = code; this.root = root; this.port = nextPort++; this.id = 0; }
  init() { this.code.initVault(this.root, { template: path.join(this.code.dir, 'templates', 'vault'), port: this.port }); return this; }
  open() {
    this.vault = new this.code.Vault(this.root, { git: false, fsync: false, commitDelayMs: 10 }).open();
    this.server = this.code.createServer(this.vault, { tunnelKey: () => null });
    ROUTES.set(String(this.port), this.server);
    // the daemon the hooks look for: this process
    fs.writeFileSync(path.join(this.root, '.memev', 'daemon.json'), JSON.stringify({ pid: process.pid, port: this.port, bind: '127.0.0.1', started: new Date().toISOString(), root: this.root }));
    return this;
  }
  close() { ROUTES.delete(String(this.port)); try { this.vault.close(); } catch {} }
  token(client) { return this.code.clientToken(this.root, client); }

  async rpc(method, params = {}, client = 'claude-code') {
    const r = await fetch(`http://127.0.0.1:${this.port}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token(client)}`, 'x-memev-client': client }, body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }) });
    const j = await r.json();
    if (j.error) throw new Error(`${method}: ${j.error.message}`);
    return j.result;
  }
  /** A tool call as the model sees it: the text content. */
  async tool(name, args = {}, client = 'claude-code') {
    const r = await this.rpc('tools/call', { name, arguments: args }, client);
    const text = (r.content || []).map((c) => c.text || '').join('');
    if (r.isError) throw new Error(`${name}: ${text}`);
    return { text, result: r };
  }
  async route(p, body, client = 'claude-code') {
    const r = await fetch(`http://127.0.0.1:${this.port}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token(client)}`, 'x-memev-client': client }, body: JSON.stringify(body) });
    return r.json();
  }
  /** Run a hook the way an app does (stdin in, stdout out) and return the text it adds to the context. */
  async hook(event, input, { project = null, client = 'claude-code' } = {}) {
    const read = fs.readFileSync, write = process.stdout.write;
    let out = '';
    fs.readFileSync = function (f, ...a) { return f === 0 ? JSON.stringify(input) : read.call(this, f, ...a); };
    process.stdout.write = (s) => { out += s; return true; };
    try { await this.code.runHook(event, { client, project, root: this.root, format: 'claude' }, process.env); }
    finally { fs.readFileSync = read; process.stdout.write = write; }
    if (!out.trim()) return '';
    let ctx; try { const j = JSON.parse(out); ctx = j.hookSpecificOutput?.additionalContext ?? ''; } catch { ctx = out; }
    if (/Memev is not reachable/.test(ctx)) throw new Error(`the ${event} hook could not reach the vault: ${ctx.slice(-200)}`);
    return ctx;
  }
}

// ---- reading results
const itemOf = (h) => `${h.path}${h.heading ? `#${h.heading}` : ''}`;
/**
 * The items (path#heading) a recall result names, from its JSON or from "- [path#heading]" lines. memev_recall puts
 * one continuation line after its JSON array when more hits match; the array is read without it.
 */
export function itemsOf(text) {
  const src = String(text || '');
  for (const t of [src, src.slice(0, src.lastIndexOf(']') + 1)]) {
    try {
      const j = JSON.parse(t);
      const hits = Array.isArray(j) ? j : Array.isArray(j?.hits) ? j.hits : Array.isArray(j?.result) ? j.result : null;
      if (hits) return hits.filter((h) => h && h.path).map(itemOf);
    } catch {}
  }
  return lineItems(text);
}
export function lineItems(text) {
  return String(text || '').split('\n').filter((l) => l.startsWith('- [')).map((l) => l.slice(3, l.indexOf('] ') > 0 ? l.indexOf('] ') : undefined));
}
/** How many entries a list result holds. */
export function entriesOf(text) {
  try {
    const j = JSON.parse(text);
    if (Array.isArray(j)) return j.length;
    for (const k of ['notes', 'entries', 'items', 'result', 'paths']) if (Array.isArray(j?.[k])) return j[k].length;
  } catch {}
  return String(text || '').split('\n').filter((l) => /\S/.test(l) && !/^(\{|\}|\[|\])/.test(l.trim())).length;
}
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const round = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : null; };
const isJournalOrDraft = (it) => it.startsWith('work/sessions/') || it.startsWith('contracts/drafts/');

// ---- the measurements
/** Fixed cost per session on an empty vault, as Claude Code sees it and as a client that loads every tool sees it. */
export async function measureFixed(code, base) {
  const b = new Bench(code, path.join(base, 'empty')).init().open();
  try {
    const init = await b.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'bench', version: '1' } });
    const tools = (await b.rpc('tools/list')).tools;
    const ss = await b.hook('session-start', { session_id: 'bench-empty', source: 'startup' }, { project: 'bench' });
    const instructions = init.instructions || '', claudeMd = code.INSTRUCTIONS || '';
    const names = tools.map((t) => `mcp__memev__${t.name}`).join('\n');
    const view = JSON.stringify(tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })));
    const n = { instructions: count(instructions), claude_md: count(claudeMd), session_start: count(ss), names: count(names), tools: count(view) };
    const protocol = norm(code.PROTOCOL);
    return {
      instructions_tokens: n.instructions, claude_md_tokens: n.claude_md, session_start_empty_tokens: n.session_start, tool_names_tokens: n.names,
      tools_count: tools.length, tools_list_tokens: n.tools,
      fixed_overhead_default: n.instructions + n.claude_md + n.session_start + n.names,
      fixed_overhead_all_tools: n.instructions + n.claude_md + n.session_start + n.tools,
      protocol_tokens: count(code.PROTOCOL || ''),
      protocol_channels: [instructions, ss, claudeMd].filter((t) => protocol && norm(t).includes(protocol)).length,
    };
  } finally { b.close(); }
}

/** A seeded vault for a level, opened with the given code. */
export function seeded(code, base, level, queries, name = 'vault') {
  const b = new Bench(code, path.join(base, `${level}-${name}`)).init();
  seedVault(b.root, level, queries);
  return b.open();
}

/** Recall quality on the tool path (memev_recall, its default limit) and the hook path (what the prompt hook injects). */
export async function measureQuality(b, queries) {
  let found6 = 0, expected = 0, rel6 = 0, ret6 = 0;
  for (const q of queries.on_topic) {
    const items = itemsOf((await b.tool('memev_recall', { query: q.prompt, project: q.project })).text).slice(0, 6);
    expected += q.expect.length; found6 += q.expect.filter((e) => items.includes(e)).length;
    rel6 += items.filter((it) => q.expect.includes(it)).length; ret6 += items.length;
  }
  const sessions = { on: [], off: [], continuation: [] };
  const run = async (name, list, projectOf) => {
    const seen = new Set();
    for (const [i, q] of list.entries()) {
      clock.advance(60000);
      const sid = `bench-${name}`, project = projectOf(q);
      const ctx = await b.hook('prompt', { session_id: sid, prompt: q.prompt }, { project });
      const items = lineItems(ctx);
      sessions[name].push({ n: i + 1, tokens: count(ctx), items, repeated: items.filter((it) => seen.has(it)).length, journal_or_draft: items.filter(isJournalOrDraft).length, ...(q.expect ? { found: q.expect.filter((e) => items.includes(e)).length } : {}) });
      for (const it of items) seen.add(it);
      clock.advance(30000);
      await b.hook('stop', { session_id: sid, last_assistant_message: 'Done. '.repeat(60) }, { project });
    }
  };
  await run('on', queries.on_topic, (q) => q.project);
  await run('off', queries.off_topic, () => queries.project_off_topic);
  await run('continuation', queries.continuation, () => queries.project_off_topic);
  const on = sessions.on, quiet = [...sessions.off, ...sessions.continuation];
  const found4 = on.reduce((a, s) => a + s.found, 0), rel4 = on.reduce((a, s, i) => a + s.items.filter((it) => queries.on_topic[i].expect.includes(it)).length, 0), ret4 = on.reduce((a, s) => a + s.items.length, 0);
  const mean = (xs) => round(xs.reduce((a, s) => a + s.tokens, 0) / xs.length, 1);
  const all = [...on, ...quiet];
  return {
    quality: {
      recall_at_6: round(found6 / expected), precision_at_6: round(ret6 ? rel6 / ret6 : 0), recall_at_4: round(found4 / expected), precision_at_4: round(ret4 ? rel4 / ret4 : 0),
      counts: { expected, found_at_6: found6, returned_at_6: ret6, relevant_at_6: rel6, found_at_4: found4, injected_at_4: ret4, relevant_at_4: rel4 },
    },
    autorecall: {
      offtopic_injection_rate: round(quiet.filter((s) => s.tokens > 0).length / quiet.length),
      prompt_mean_on: mean(on), prompt_mean_off: mean(sessions.off), prompt_mean_continuation: mean(sessions.continuation),
      repeated_items: all.reduce((a, s) => a + s.repeated, 0), journal_draft_items: all.reduce((a, s) => a + s.journal_or_draft, 0),
      injected: { on: on.filter((s) => s.tokens > 0).length, off: sessions.off.filter((s) => s.tokens > 0).length, continuation: sessions.continuation.filter((s) => s.tokens > 0).length },
      per_prompt_tokens: { on: on.map((s) => s.tokens), off: sessions.off.map((s) => s.tokens), continuation: sessions.continuation.map((s) => s.tokens) },
    },
  };
}

/** Session start after a compaction and on resume, against the resume card alone. */
export async function measureResume(b, code) {
  clock.advance(60000);
  const compact = await b.hook('session-start', { session_id: 'bench-on', source: 'compact' }, { project: 'billing' });
  const resume = await b.hook('session-start', { session_id: 'bench-on', source: 'resume' }, { project: 'billing' });
  // the card this same session gets, so the comparison is like with like (another session's card lists a different last session)
  const card = await b.route('/v1/session-start', { session: 'bench-on', project: 'billing', task: null });
  const protocol = norm(code.PROTOCOL);
  return {
    session_start_compact_tokens: count(compact), session_start_compact_has_protocol: protocol && norm(compact).includes(protocol) ? 1 : 0,
    session_start_resume_tokens: count(resume), session_start_resume_has_protocol: protocol && norm(resume).includes(protocol) ? 1 : 0,
    card_tokens: count(card.text || ''),
  };
}

/** The largest results the model can ask for: one call each, at fixed stress inputs. */
export async function measureCaps(b) {
  const out = {};
  const biggest = fs.readdirSync(path.join(b.root, 'memory'), { recursive: true }).filter((f) => f.endsWith('.md')).map((f) => `memory/${f.split(path.sep).join('/')}`)
    .sort((x, y) => fs.statSync(path.join(b.root, y)).size - fs.statSync(path.join(b.root, x)).size || x.localeCompare(y))[0];
  const get = await b.tool('memev_get', { path: biggest });
  out.get = count(get.text); out.get_chars = get.text.length; out.get_note = biggest;
  // the report's recall stress input: one common query over every project
  const q = { query: 'database migration', all_projects: true };
  out.recall_limit_1000 = count((await b.tool('memev_recall', { ...q, limit: 1000 })).text);
  out.recall_limit_10 = count((await b.tool('memev_recall', { ...q, limit: 10 })).text);
  const six = await b.tool('memev_recall', { ...q, limit: 6 });
  out.recall_6hit = count(six.text); out.recall_6hit_items = itemsOf(six.text).length;
  const list = await b.tool('memev_list', {});
  out.list = count(list.text); out.list_entries = entriesOf(list.text);
  // another app posts 200 messages to everyone; this app reads them
  const R = 'Status from the other app: the staging migration ran, three of four suites are green, the flaky export test is retrying with a longer timeout, and the index on (tenant_id, created_at) cut the export from 40 s to 3 s. ';
  for (let i = 0; i < 200; i++) { clock.advance(1000); await b.tool('bus_send', { to: 'all', type: 'status', body: `${i + 1}. ${R}`.slice(0, 300) }, 'codex'); }
  out.bus_unread_200 = count((await b.tool('bus_unread', {})).text);
  return out;
}

/** Recall latency on the tool path: every labelled prompt, repeated; with a second vault, the two interleaved. */
export async function measureLatency(benches, queries, reps) {
  const prompts = [...queries.on_topic.map((q) => [q.prompt, q.project]), ...queries.off_topic.map((q) => [q.prompt, queries.project_off_topic])];
  const ms = benches.map(() => []);
  for (const [p, project] of prompts) for (const b of benches) await b.tool('memev_recall', { query: p, project }); // warm up
  for (let r = 0; r < reps; r++) {
    for (const [p, project] of prompts) {
      const order = r % 2 ? [...benches.keys()].reverse() : [...benches.keys()];
      for (const i of order) { const t = performance.now(); await benches[i].tool('memev_recall', { query: p, project }); ms[i].push(performance.now() - t); }
    }
  }
  return ms.map((xs) => ({ recall_p50_ms: round(pct(xs, 50), 3), recall_p95_ms: round(pct(xs, 95), 3), samples: xs.length }));
}

export { LEVELS };
