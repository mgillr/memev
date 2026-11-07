// SPDX-License-Identifier: Apache-2.0
// Chat history on this computer, and chat export files, as import sources: each conversation or session becomes one
// note under memory/imports/history/<app>/<project>/. Every source is read-only: files are opened for reading and
// never changed, moved or removed. Nothing here touches the network.
//
// A source is found by a cheap scan (directory listings and file sizes, and for an export one streamed pass that
// counts its conversations), so setup can show what exists before anything is read in full. The import streams the
// source a second time and writes one conversation at a time: a multi-hundred-MB export is never held in memory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { sha256, slug } from '../util.mjs';
import { findSecrets } from '../secrets.mjs';
import { listZip, entryStream } from '../zip.mjs';
import { jsonArrayItems, NotAnArray } from '../json-stream.mjs';
import { detectFormat, chatgptConversation, claudeConversation, iso, short } from './chat-formats.mjs';

export const HISTORY_DIR = 'memory/imports/history';
export const MAX_NOTE_BYTES = 2 * 1024 * 1024; // a conversation whose note would pass this is skipped, by itself
export const MAX_ITEM_BYTES = 64 * 1024 * 1024; // a raw export element past this is passed over without being kept
export const MAX_LINE_BYTES = 8 * 1024 * 1024; // a session log line past this is tool payload, not conversation
export const DEFAULT_MARK_MAX = 100; // setup marks a source for import only when it holds this many items or fewer

const KEY_HASH = (key) => sha256(key).slice(0, 12);
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const dirents = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }); } catch { return []; } };
const statOf = (f) => { try { return fs.statSync(f); } catch { return null; } };

function homeOf(env) { return env.HOME || env.USERPROFILE || os.homedir(); }

// ---- reading helpers

async function* jsonlRecords(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 1 << 20 }), crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line || line.length > MAX_LINE_BYTES) continue;
      try { yield JSON.parse(line); } catch { /* a torn last line while the app writes: left out */ }
    }
  } finally { rl.close(); }
}

function readJsonFile(file, max = MAX_ITEM_BYTES) {
  const st = statOf(file);
  if (!st || !st.isFile() || st.size > max) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// text blocks of an Anthropic-style message: a string, or blocks of text / tool_use / tool_result / thinking / image
function anthropicText(content, { toolResults = 'line' } = {}) {
  if (typeof content === 'string') return { text: content, tools: [] };
  const lines = []; const tools = [];
  for (const b of Array.isArray(content) ? content : []) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'text' && typeof b.text === 'string') lines.push(b.text);
    else if (b.type === 'tool_use') tools.push(`[tool call: ${short(b.name || 'tool')}]`);
    else if (b.type === 'tool_result' && toolResults === 'line') tools.push('[tool output]');
    else if (b.type === 'image') tools.push('[image]');
  }
  return { text: lines.join('\n'), tools };
}

// wrappers an app puts into the user's turn that the person did not type
function cleanUserText(t) {
  return String(t || '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<local-command-(?:stdout|stderr|caveat)>[\s\S]*?<\/local-command-(?:stdout|stderr|caveat)>/g, '')
    .replace(/<command-(?:message|args)>[\s\S]*?<\/command-(?:message|args)>/g, '')
    .replace(/<(session-start-hook|ide_opened_file|ide_selection)>[\s\S]*?<\/\1>/g, '')
    .replace(/<command-name>([\s\S]*?)<\/command-name>/g, (_, n) => `[command: ${short(n)}]`)
    .trim();
}

// ---- local session sources

// Claude Code keeps one JSONL transcript per session in ~/.claude/projects/<project folder>/<session id>.jsonl
// (CLAUDE_CONFIG_DIR moves ~/.claude). Records: type user | assistant carry message.role and message.content;
// isMeta marks text the app injected, isSidechain a subagent's turn; ai-title, summary and custom-title records
// carry a title, as does customTitle. The vendor says the entry format is internal and changes between versions, so
// every field is optional and an unknown line is passed over. Subagent transcripts in <session>/subagents/ are left
// out, and so is a compacted summary, which the app wrote, not the person.
const claudeCode = {
  id: 'claude-code', app: 'Claude Code', kind: 'sessions',
  root: (env) => path.join(env.CLAUDE_CONFIG_DIR || path.join(homeOf(env), '.claude'), 'projects'),
  files(env) {
    const root = this.root(env); const out = [];
    for (const d of dirents(root)) {
      if (!d.isDirectory()) continue;
      // a set-aside copy (<session>.orphaned-<time>-<suffix>.jsonl) repeats a session, so it is left out
      for (const f of dirents(path.join(root, d.name))) if (f.isFile() && f.name.endsWith('.jsonl') && !f.name.includes('.orphaned-')) out.push({ file: path.join(root, d.name, f.name), project: d.name });
    }
    return out;
  },
  async *read({ file, project }) {
    const turns = []; let id = path.basename(file, '.jsonl'), title = null, cwd = null, first = null, last = null;
    for await (const r of jsonlRecords(file)) {
      if (r.type === 'ai-title' && r.aiTitle) title = String(r.aiTitle);
      else if (r.type === 'custom-title' && r.customTitle) title = String(r.customTitle);
      else if (r.type === 'summary' && r.summary && !title) title = String(r.summary);
      if (r.type !== 'user' && r.type !== 'assistant') continue;
      if (r.isMeta || r.isSidechain || r.isCompactSummary || !r.message) continue;
      if (r.sessionId) id = String(r.sessionId);
      if (r.cwd && !cwd) cwd = String(r.cwd);
      const at = iso(r.timestamp); if (at) { first = first || at; last = at; }
      const role = r.type;
      const { text, tools } = anthropicText(r.message.content, { toolResults: 'drop' });
      const t = role === 'user' ? cleanUserText(text) : text.trim();
      pushTurn(turns, role, t, at, tools);
    }
    yield { id, title, created: first, updated: last, project: cwd || project, projectKey: project, turns };
  },
};

// Codex CLI writes one rollout per session to $CODEX_HOME/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl (CODEX_HOME
// defaults to ~/.codex). Lines are {timestamp, type, payload}: session_meta carries id and cwd, response_item carries
// a message {role, content: [{type: input_text | output_text, text}]} or a function call and its output.
const codex = {
  id: 'codex', app: 'Codex', kind: 'sessions',
  root: (env) => path.join(env.CODEX_HOME || path.join(homeOf(env), '.codex'), 'sessions'),
  files(env) {
    const out = [];
    const walk = (d, depth) => { for (const e of dirents(d)) { const p = path.join(d, e.name); if (e.isDirectory() && depth < 4) walk(p, depth + 1); else if (e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)) out.push({ file: p, project: null }); } };
    // archived sessions sit beside sessions/; a compressed rollout (.jsonl.zst) is not read
    walk(this.root(env), 0);
    walk(path.join(path.dirname(this.root(env)), 'archived_sessions'), 0);
    return out;
  },
  async *read({ file }) {
    const turns = []; let id = null, cwd = null, first = null, last = null;
    for await (const r of jsonlRecords(file)) {
      const p = r.payload || {};
      const at = iso(r.timestamp || p.timestamp);
      if (r.type === 'session_meta') { id = p.id || id; cwd = p.cwd || cwd; first = first || iso(p.timestamp) || at; continue; }
      if (r.type !== 'response_item') continue;
      if (at) { first = first || at; last = at; }
      if (p.type === 'message' && (p.role === 'user' || p.role === 'assistant')) {
        const text = (Array.isArray(p.content) ? p.content : []).filter((c) => c && (c.type === 'input_text' || c.type === 'output_text') && typeof c.text === 'string').map((c) => c.text).join('\n').trim();
        // the context Codex adds as user messages (<user_instructions>, <environment_context>, <skills_instructions>
        // and the other tagged fragments) is not the person's words: a message wholly inside one tag is left out
        if (p.role === 'user' && /^<([a-z_]+)>[\s\S]*<\/\1>$/.test(text)) continue;
        if (p.role === 'user' && /^# AGENTS\.md instructions/.test(text)) continue;
        pushTurn(turns, p.role, text, at, []);
      } else if (p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call') pushTurn(turns, 'assistant', '', at, [`[tool call: ${short(p.name || p.type)}]`]);
    }
    if (!id) { const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(file); id = m ? m[1] : path.basename(file, '.jsonl'); }
    yield { id, title: null, created: first, updated: last, project: cwd, projectKey: cwd, turns };
  },
};

// Gemini CLI saves each chat under <home>/.gemini/tmp/<project>/chats/ (GEMINI_CLI_HOME moves the home it uses):
// session-<time>-<id>.jsonl in current versions, a single session-*.json in older ones. A .jsonl starts with the
// session's metadata {sessionId, projectHash, startTime, lastUpdated, summary}, then one message per line {id,
// timestamp, type: user | gemini | info | error | warning, content, toolCalls}; a later line with the same id replaces
// the message, and control lines edit what came before: {$rewindTo: id} drops that message and everything after it,
// {$patch} changes, removes or reorders messages, {$set} updates the metadata. The project folder holds a
// .project_root file naming the project's own folder.
function partsText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === 'string' ? p : p && typeof p.text === 'string' && !p.thought ? p.text : '')).filter(Boolean).join('\n');
  if (content && typeof content.text === 'string') return content.text;
  return '';
}

export function geminiReplay(lines) {
  let meta = {}; let msgs = [];
  for (const r of lines) {
    if (!r || typeof r !== 'object') continue;
    if (typeof r.$rewindTo === 'string') { const i = msgs.findIndex((m) => m.id === r.$rewindTo); if (i >= 0) msgs = msgs.slice(0, i); continue; }
    if (r.$set && typeof r.$set === 'object') { const { messages, ...rest } = r.$set; meta = { ...meta, ...rest }; if (Array.isArray(messages)) msgs = messages.slice(); continue; }
    if (r.$patch && typeof r.$patch === 'object') {
      const p = r.$patch;
      const apply = (u) => { const m = u && msgs.find((x) => x.id === u.id); if (m && u.content !== undefined) m.content = u.content; };
      if (p.id) apply(p);
      for (const u of Array.isArray(p.updates) ? p.updates : []) apply(u);
      if (Array.isArray(p.removeIds)) msgs = msgs.filter((m) => !p.removeIds.includes(m.id));
      if (Array.isArray(p.orderIds)) { const pos = new Map(p.orderIds.map((id, i) => [id, i])); msgs.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9)); }
      continue;
    }
    if (typeof r.type === 'string' && r.id !== undefined) { const i = msgs.findIndex((m) => m.id === r.id); if (i >= 0) msgs[i] = r; else msgs.push(r); continue; }
    if (r.sessionId) meta = { ...meta, ...r };
  }
  return { ...meta, messages: msgs };
}

const gemini = {
  id: 'gemini-cli', app: 'Gemini CLI', kind: 'sessions',
  root: (env) => path.join(env.GEMINI_CLI_HOME || homeOf(env), '.gemini', 'tmp'),
  files(env) {
    const root = this.root(env); const out = [];
    for (const d of dirents(root)) {
      if (!d.isDirectory()) continue;
      for (const f of dirents(path.join(root, d.name, 'chats'))) if (f.isFile() && /^session-.*\.jsonl?$/.test(f.name)) out.push({ file: path.join(root, d.name, 'chats', f.name), project: d.name });
    }
    return out;
  },
  async *read({ file, project }) {
    let s;
    if (file.endsWith('.jsonl')) { const lines = []; for await (const r of jsonlRecords(file)) lines.push(r); s = geminiReplay(lines); }
    else s = readJsonFile(file);
    if (!s || !Array.isArray(s.messages)) return;
    if (s.kind === 'subagent') return;
    const turns = [];
    for (const m of s.messages) {
      if (!m || typeof m !== 'object') continue;
      const role = m.type === 'user' ? 'user' : m.type === 'gemini' ? 'assistant' : null;
      if (!role) continue;
      const tools = (Array.isArray(m.toolCalls) ? m.toolCalls : []).map((t) => `[tool call: ${short(t?.name || 'tool')}]`);
      pushTurn(turns, role, partsText(m.content).trim(), iso(m.timestamp), tools);
    }
    let root = null; try { root = fs.readFileSync(path.join(path.dirname(path.dirname(file)), '.project_root'), 'utf8').trim() || null; } catch {}
    yield { id: String(s.sessionId || path.basename(file).replace(/\.jsonl?$/, '')), title: s.summary || null, created: iso(s.startTime), updated: iso(s.lastUpdated), project: root || project, projectKey: project, turns };
  },
};

// Qwen Code, built from Gemini CLI, writes <base>/projects/<project folder>/chats/<session id>.jsonl, where <base> is
// QWEN_RUNTIME_DIR, else QWEN_HOME, else ~/.qwen. Records {uuid, sessionId, timestamp, type: user | assistant |
// tool_result | system, subtype, cwd, isSidechain, message: {role, parts: [{text} | {functionCall} | ...]}}.
const qwen = {
  id: 'qwen-code', app: 'Qwen Code', kind: 'sessions',
  root: (env) => path.join(env.QWEN_RUNTIME_DIR || env.QWEN_HOME || path.join(homeOf(env), '.qwen'), 'projects'),
  files(env) {
    const root = this.root(env); const out = [];
    for (const d of dirents(root)) {
      if (!d.isDirectory()) continue;
      for (const f of dirents(path.join(root, d.name, 'chats'))) if (f.isFile() && f.name.endsWith('.jsonl')) out.push({ file: path.join(root, d.name, 'chats', f.name), project: d.name });
    }
    return out;
  },
  async *read({ file, project }) {
    const turns = []; let id = path.basename(file, '.jsonl'), cwd = null, first = null, last = null;
    for await (const r of jsonlRecords(file)) {
      if (r.type !== 'user' && r.type !== 'assistant') continue;
      if (r.isSidechain || r.subtype === 'agent_mention' || r.subtype === 'agent_message' || !r.message) continue;
      if (r.sessionId) id = String(r.sessionId);
      if (r.cwd && !cwd) cwd = String(r.cwd);
      const at = iso(r.timestamp); if (at) { first = first || at; last = at; }
      const parts = Array.isArray(r.message.parts) ? r.message.parts : [];
      const tools = parts.filter((p) => p && p.functionCall).map((p) => `[tool call: ${short(p.functionCall.name || 'tool')}]`);
      pushTurn(turns, r.type, partsText(parts).trim(), at, tools);
    }
    yield { id, title: null, created: first, updated: last, project: cwd || project, projectKey: project, turns };
  },
};

// Jan keeps each thread in <data folder>/threads/<thread id>/: thread.json {id, title, created, updated} and
// messages.jsonl, one message per line {role, content: [{type: text, text: {value}}], created_at}.
const jan = {
  id: 'jan', app: 'Jan', kind: 'sessions',
  root(env) {
    if (env.MEMEV_JAN_DATA) return path.join(env.MEMEV_JAN_DATA, 'threads');
    const home = homeOf(env);
    if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Jan', 'data', 'threads');
    if (process.platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Jan', 'data', 'threads');
    return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'Jan', 'data', 'threads');
  },
  files(env) {
    const root = this.root(env); const out = [];
    for (const d of dirents(root)) if (d.isDirectory() && exists(path.join(root, d.name, 'messages.jsonl'))) out.push({ file: path.join(root, d.name, 'messages.jsonl'), project: null });
    return out;
  },
  async *read({ file }) {
    const meta = readJsonFile(path.join(path.dirname(file), 'thread.json'), 4 * 1024 * 1024) || {};
    const turns = [];
    for await (const m of jsonlRecords(file)) {
      const role = m.role === 'user' || m.role === 'assistant' ? m.role : null;
      if (!role) continue;
      const text = (Array.isArray(m.content) ? m.content : []).map((c) => (c?.type === 'text' ? c.text?.value || '' : '')).join('\n').trim();
      pushTurn(turns, role, text, iso(m.created_at), []);
    }
    yield { id: String(meta.id || path.basename(path.dirname(file))), title: meta.title || null, created: iso(meta.created), updated: iso(meta.updated), project: null, projectKey: null, turns };
  },
};

// Continue keeps each session in ~/.continue/sessions/<session id>.json (CONTINUE_GLOBAL_DIR moves ~/.continue):
// {sessionId, title, workspaceDirectory, history: [{message: {role, content}}]}; sessions.json is the index, with
// dateCreated for each session.
const continueDev = {
  id: 'continue', app: 'Continue', kind: 'sessions',
  root: (env) => path.join(env.CONTINUE_GLOBAL_DIR ? path.resolve(env.CONTINUE_GLOBAL_DIR) : path.join(homeOf(env), '.continue'), 'sessions'),
  files(env) {
    const root = this.root(env);
    return dirents(root).filter((f) => f.isFile() && f.name.endsWith('.json') && f.name !== 'sessions.json').map((f) => ({ file: path.join(root, f.name), project: null }));
  },
  async *read({ file }) {
    const s = readJsonFile(file);
    if (!s || !Array.isArray(s.history)) return;
    const index = readJsonFile(path.join(path.dirname(file), 'sessions.json'), 16 * 1024 * 1024);
    const meta = Array.isArray(index) ? index.find((x) => x && x.sessionId === s.sessionId) : null;
    const turns = [];
    for (const h of s.history) {
      const m = h?.message; if (!m) continue;
      if (m.role === 'tool') { pushTurn(turns, 'assistant', '', null, ['[tool output]']); continue; }
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      const text = typeof m.content === 'string' ? m.content : (Array.isArray(m.content) ? m.content : []).map((p) => (p?.type === 'text' ? p.text || '' : '')).join('\n');
      const tools = (Array.isArray(m.toolCalls) ? m.toolCalls : []).map((t) => `[tool call: ${short(t?.function?.name || 'tool')}]`);
      pushTurn(turns, m.role, String(text).trim(), null, tools);
    }
    const created = iso(meta?.dateCreated);
    yield { id: String(s.sessionId || path.basename(file, '.json')), title: s.title || null, created, updated: created, project: s.workspaceDirectory || null, projectKey: s.workspaceDirectory || null, turns };
  },
};

// Cline keeps each task's conversation in ~/.cline/data/tasks/<task id>/api_conversation_history.json, in the
// Anthropic message format: [{role, content: string | [{type: text | tool_use | tool_result | image}]}].
const cline = {
  id: 'cline', app: 'Cline', kind: 'sessions',
  root: (env) => path.join(homeOf(env), '.cline', 'data', 'tasks'),
  files(env) {
    const root = this.root(env); const out = [];
    for (const d of dirents(root)) if (d.isDirectory() && exists(path.join(root, d.name, 'api_conversation_history.json'))) out.push({ file: path.join(root, d.name, 'api_conversation_history.json'), project: null });
    return out;
  },
  async *read({ file }) {
    const msgs = readJsonFile(file);
    if (!Array.isArray(msgs)) return;
    const turns = [];
    for (const m of msgs) {
      if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
      const { text, tools } = anthropicText(m.content, { toolResults: 'drop' });
      // Cline wraps the person's words in <task> or <feedback>, and adds <environment_details> to each turn
      const t = String(text).replace(/<environment_details>[\s\S]*?<\/environment_details>/g, '').replace(/<\/?(?:task|feedback|user_message)>/g, '').trim();
      pushTurn(turns, m.role, m.role === 'user' ? cleanUserText(t) : t, iso(m.ts), tools);
    }
    const id = path.basename(path.dirname(file));
    const st = statOf(file);
    const created = /^\d{12,14}$/.test(id) ? iso(Number(id)) : null; // a task id is the start time in milliseconds
    yield { id, title: null, created, updated: st ? st.mtime.toISOString() : created, project: null, projectKey: null, turns };
  },
};

function pushTurn(turns, role, text, at, tools) {
  const prev = turns[turns.length - 1];
  if (text) turns.push({ role, text, at, tools: [...tools] });
  else if (tools.length) {
    if (prev && prev.role === role) prev.tools.push(...tools);
    else turns.push({ role, text: '', at, tools: [...tools] });
  }
}

export const SESSION_SOURCES = [
  claudeCode,
  codex,
  gemini,
  qwen,
  jan,
  continueDev,
  cline,
];

// ---- export sources: a ChatGPT or Claude export zip, an unpacked export folder, or a conversations.json

const CONV_FILE = /(?:^|\/)conversations(?:-\d+)?\.json$/i;

function exportParts(file) {
  // the conversation files of an export, in order: conversations.json, or its shards conversations-000.json and on
  const st = statOf(file);
  if (!st) return null;
  if (st.isDirectory()) {
    const names = dirents(file).filter((e) => e.isFile() && CONV_FILE.test(e.name)).map((e) => e.name).sort();
    const parts = names.map((n) => ({ name: n, size: statOf(path.join(file, n))?.size || 0, open: () => fs.createReadStream(path.join(file, n), { highWaterMark: 1 << 20 }) }));
    const projects = () => readJsonFile(path.join(file, 'projects.json'), 16 * 1024 * 1024);
    return { kind: 'folder', parts, projects };
  }
  if (/\.json$/i.test(file)) return { kind: 'json', parts: [{ name: path.basename(file), size: st.size, open: () => fs.createReadStream(file, { highWaterMark: 1 << 20 }) }], projects: () => null };
  let entries;
  try { entries = listZip(file); } catch { return null; }
  const conv = entries.filter((e) => CONV_FILE.test(e.name)).sort((a, b) => a.name.localeCompare(b.name));
  const proj = entries.find((e) => /(?:^|\/)projects\.json$/i.test(e.name));
  const parts = conv.map((e) => ({ name: e.name, size: e.size, open: () => entryStream(file, e) }));
  const projects = async () => {
    if (!proj || proj.size > 16 * 1024 * 1024) return null;
    const chunks = []; for await (const c of entryStream(file, proj)) chunks.push(c);
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
  };
  return { kind: 'zip', parts, projects, entries };
}

/** Conversations of an export, one at a time, as { conv } or { skip: reason, bytes }. */
export async function* exportConversations(file, { maxItemBytes = MAX_ITEM_BYTES } = {}) {
  const ex = exportParts(file);
  if (!ex) return;
  let projects = null;
  try { const p = await ex.projects(); if (Array.isArray(p)) projects = new Map(p.filter((x) => x && x.uuid).map((x) => [x.uuid, x.name || x.uuid])); } catch {}
  for (const part of ex.parts) {
    let elements;
    try { elements = jsonArrayItems(part.open(), { maxItemBytes }); } catch { continue; }
    try {
      for await (const el of elements) {
        if (el.tooLarge) { yield { skip: 'too large', bytes: el.bytes }; continue; }
        if (el.bad) { yield { skip: 'unreadable', bytes: el.bytes }; continue; }
        const fmt = detectFormat(el.value);
        if (!fmt) continue; // an empty {} entry, which ChatGPT exports carry
        const conv = fmt === 'chatgpt' ? chatgptConversation(el.value) : claudeConversation(el.value, { projects });
        yield { conv: { ...conv, format: fmt, projectKey: conv.project }, bytes: el.bytes };
      }
    } catch (e) {
      if (!(e instanceof NotAnArray)) throw e;
      // an older export kept the list under a conversations key: read whole when it is small enough
      if (part.size > maxItemBytes) continue;
      const chunks = []; for await (const c of part.open()) chunks.push(c);
      let data; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { continue; }
      for (const c of Array.isArray(data?.conversations) ? data.conversations : []) {
        const fmt = detectFormat(c);
        if (!fmt) continue;
        const conv = fmt === 'chatgpt' ? chatgptConversation(c) : claudeConversation(c, { projects });
        yield { conv: { ...conv, format: fmt, projectKey: conv.project }, bytes: 0 };
      }
    }
  }
}

function exportSource(file) {
  const abs = path.resolve(file);
  return { id: `export:${abs}`, app: 'Chat export', kind: 'export', file: abs };
}

/** Export files the person may have downloaded: zips at the top of ~/Downloads that hold a conversations file. */
export function findExports(env) {
  const dl = path.join(homeOf(env), 'Downloads');
  const out = [];
  for (const e of dirents(dl).slice(0, 2000)) {
    if (!e.isFile() || !/\.zip$/i.test(e.name)) continue;
    const f = path.join(dl, e.name);
    try { if (listZip(f).some((x) => CONV_FILE.test(x.name))) out.push(f); } catch {}
    if (out.length >= 50) break;
  }
  return out;
}

// ---- scan

function fileStats(files) {
  let bytes = 0, first = null, last = null;
  for (const f of files) {
    const st = statOf(f.file); if (!st) continue;
    bytes += st.size;
    const b = (st.birthtimeMs && st.birthtimeMs > 0 ? st.birthtime : st.mtime).toISOString();
    const m = st.mtime.toISOString();
    if (!first || b < first) first = b;
    if (!last || m > last) last = m;
  }
  return { count: files.length, bytes, first, last };
}

/**
 * Every history source found, without importing: [{ id, app, kind, path, count, bytes, first, last, projects? }].
 * Session sources are counted from file listings (dates are the files' own times); an export is streamed once to count
 * its conversations. With quick set, an export found in ~/Downloads is listed by its size only (count null), so setup
 * stays fast; one named in exports is always counted.
 */
export async function scanHistory({ env, exports = [], findDownloads = true, quick = false, maxItemBytes = MAX_ITEM_BYTES } = {}) {
  if (!env) throw new Error('scanHistory needs the env whose home it reads');
  const out = [];
  for (const s of SESSION_SOURCES) {
    const root = s.root(env);
    if (!isDir(root)) continue;
    const files = s.files(env);
    if (!files.length) continue;
    const st = fileStats(files);
    const src = { id: s.id, app: s.app, kind: 'sessions', path: root, unit: 'sessions', ...st };
    const byProject = new Map();
    for (const f of files) if (f.project) { const l = byProject.get(f.project) || []; l.push(f); byProject.set(f.project, l); }
    if (byProject.size) src.projects = [...byProject].map(([p, l]) => ({ id: `${s.id}/${p}`, name: p, ...fileStats(l) })).sort((a, b) => String(b.last).localeCompare(String(a.last)));
    out.push(src);
  }
  const named = new Set(exports.map((f) => path.resolve(f)));
  const files = [...new Set([...named, ...(findDownloads ? findExports(env) : [])])];
  for (const f of files) {
    const s = exportSource(f);
    if (quick && !named.has(f)) { out.push({ id: s.id, app: 'Chat export', kind: 'export', path: f, unit: 'conversations', count: null, bytes: statOf(f)?.size || 0, first: null, last: null }); continue; }
    let count = 0, first = null, last = null, tooLarge = 0, format = null;
    try {
      for await (const r of exportConversations(f, { maxItemBytes })) {
        if (r.skip) { tooLarge++; continue; }
        count++; format = format || r.conv.format;
        const a = r.conv.created || r.conv.updated, b = r.conv.updated || r.conv.created;
        if (a && (!first || a < first)) first = a;
        if (b && (!last || b > last)) last = b;
      }
    } catch { continue; }
    if (!count && !tooLarge) continue;
    out.push({ id: s.id, app: format === 'chatgpt' ? 'ChatGPT export' : format === 'claude' ? 'Claude export' : 'Chat export', kind: 'export', path: f, unit: 'conversations', count, bytes: statOf(f)?.size || 0, first, last, ...(tooLarge ? { too_large: tooLarge } : {}) });
  }
  return out;
}

// ---- notes

function render(conv, meta) {
  const lines = [`# ${conv.title || 'Untitled conversation'}`, ''];
  lines.push(`Source: ${meta.source}`);
  lines.push(`App: ${meta.app}`);
  if (conv.project) lines.push(`Project: ${conv.project}`);
  if (conv.created) lines.push(`Started: ${conv.created}`);
  if (conv.updated && conv.updated !== conv.created) lines.push(`Updated: ${conv.updated}`);
  lines.push(`Import: ${meta.importId}`, `Key: ${meta.key}`, `Hash: ${meta.hash}`, '');
  for (const t of conv.turns) {
    const head = `### ${t.role === 'user' ? 'User' : 'Assistant'}${t.at ? ` (${t.at.slice(0, 16).replace('T', ' ')})` : ''}`;
    lines.push(head);
    if (t.text) lines.push(t.text);
    if (t.tools?.length) lines.push(collapse(t.tools));
    lines.push('');
  }
  return lines.join('\n');
}

function collapse(tools) {
  const out = [];
  for (const t of tools) { const p = out[out.length - 1]; if (p && p.t === t) p.n++; else out.push({ t, n: 1 }); }
  return out.map(({ t, n }) => (n > 1 ? `${t} x${n}` : t)).join(' ');
}

function titleFrom(conv) {
  if (conv.title) return conv.title;
  const u = conv.turns.find((t) => t.role === 'user' && t.text);
  return u ? short(u.text, 70) : null;
}

/** The key that names one conversation across imports: the same conversation, read again, gives the same key. */
export function conversationKey(appId, conv, sourcePath) {
  if (conv.id) return `${appId}:${conv.id}`;
  return `${appId}:${sha256(`${sourcePath}\0${conv.created || ''}\0${conv.title || ''}`).slice(0, 24)}`;
}

export function noteRelFor(appId, conv, key) {
  const date = (conv.created || conv.updated || '').slice(0, 10) || 'undated';
  const proj = conv.projectKey || conv.project ? slug(String(conv.projectKey || conv.project).replace(/^[-/\\]+/, ''), 60) : 'chats';
  return `${HISTORY_DIR}/${slug(appId, 40)}/${proj}/${date}-${slug(titleFrom(conv) || 'conversation', 40)}-${KEY_HASH(key)}.md`;
}

/** The key hashes already in the vault, read from the note names alone: no note is opened. */
export function importedKeyHashes(vault) {
  const set = new Set();
  for (const rel of vault.allNotes()) {
    if (!rel.startsWith(HISTORY_DIR + '/')) continue;
    const m = /-([0-9a-f]{12})\.md$/.exec(rel);
    if (m) set.add(m[1]);
  }
  return set;
}

// a selection names a whole source (claude-code, export:/path) or one project of it (claude-code/<project folder>)
function sourcesFor(selection, env) {
  const out = [];
  for (const sel of selection) {
    if (sel.startsWith('export:')) { out.push({ kind: 'export', id: sel, file: sel.slice('export:'.length) }); continue; }
    const [sid, ...rest] = sel.split('/');
    const s = SESSION_SOURCES.find((x) => x.id === sid);
    if (!s) continue;
    out.push({ kind: 'sessions', id: sel, source: s, project: rest.length ? rest.join('/') : null });
  }
  return out;
}

async function* conversationsOf(sel, env, { maxItemBytes = MAX_ITEM_BYTES } = {}) {
  if (sel.kind === 'export') {
    for await (const r of exportConversations(sel.file, { maxItemBytes })) {
      if (r.skip) { yield { skip: r.skip, title: `conversation of ${short(path.basename(sel.file), 40)}`, app: 'export' }; continue; }
      const appId = r.conv.format === 'chatgpt' ? 'chatgpt' : 'claude';
      yield { conv: r.conv, appId, app: r.conv.format === 'chatgpt' ? 'ChatGPT' : 'Claude', source: `${r.conv.format === 'chatgpt' ? 'ChatGPT' : 'Claude'} export (${path.basename(sel.file)})`, sourcePath: sel.file };
    }
    return;
  }
  const s = sel.source;
  for (const f of s.files(env)) {
    if (sel.project && f.project !== sel.project) continue;
    try {
      for await (const conv of s.read(f)) yield { conv, appId: s.id, app: s.app, source: `${s.app} session (${f.file})`, sourcePath: f.file };
    } catch { yield { skip: 'unreadable', title: path.basename(f.file), app: s.id }; }
  }
}

/**
 * Walk the chosen sources and decide, conversation by conversation, what an import would do. With write set, it
 * writes each new conversation as its own note as it goes, so only one conversation is held at a time.
 * Returns counts, and up to listMax preview entries.
 */
export async function walkHistory(vault, identity, selection, { env, importId = null, write = false, onNote = null, listMax = 200, maxItemBytes = MAX_ITEM_BYTES } = {}) {
  if (!env) throw new Error('walkHistory needs the env whose home it reads');
  const known = importedKeyHashes(vault);
  const counts = { found: 0, new: 0, imported: 0, already: 0, secret: 0, too_large: 0, empty: 0, unreadable: 0 };
  const bySource = new Map();
  const listed = [];
  const notes = [];
  const seenThisRun = new Set();
  for (const sel of sourcesFor(selection, env)) {
    const per = { id: sel.id, found: 0, new: 0, secret: 0, too_large: 0, already: 0, empty: 0, unreadable: 0 };
    bySource.set(sel.id, per);
    for await (const r of conversationsOf(sel, env, { maxItemBytes })) {
      counts.found++; per.found++;
      const bump = (k) => { counts[k]++; per[k]++; };
      if (r.skip) { bump(r.skip === 'too large' ? 'too_large' : 'unreadable'); if (listed.length < listMax) listed.push({ title: r.title, reason: r.skip, source: sel.id }); continue; }
      const { conv } = r;
      const key = conversationKey(r.appId, conv, r.sourcePath);
      const kh = KEY_HASH(key);
      if (known.has(kh) || seenThisRun.has(kh)) { bump('already'); continue; }
      seenThisRun.add(kh);
      if (!conv.turns.some((t) => t.text)) { bump('empty'); continue; }
      const title = titleFrom(conv) || 'Untitled conversation';
      const body0 = render({ ...conv, title }, { source: r.source, app: r.app, importId: importId || 'imp-preview', key, hash: 'sha256:' + '0'.repeat(16) });
      if (Buffer.byteLength(body0) > MAX_NOTE_BYTES) { bump('too_large'); if (listed.length < listMax) listed.push({ title, reason: 'too large', source: sel.id }); continue; }
      if (findSecrets(body0).length) { bump('secret'); if (listed.length < listMax) listed.push({ title, reason: 'secret', source: sel.id }); continue; }
      bump('new');
      if (listed.length < listMax) listed.push({ title, size: Buffer.byteLength(body0), source: sel.id, date: (conv.created || '').slice(0, 10) || null });
      if (!write) continue;
      const hash = 'sha256:' + sha256(body0).slice(0, 16);
      const body = render({ ...conv, title }, { source: r.source, app: r.app, importId, key, hash });
      const rel = noteRelFor(r.appId, { ...conv, title }, key);
      try {
        vault.write(identity, { path: rel, body, client: 'import' });
        known.add(kh); counts.imported++; notes.push(rel);
        if (onNote) onNote(rel);
      } catch (e) {
        // the vault's own guard has the last word: a note it refuses is counted, never half written
        if (e && e.code === 'secret') { counts.new--; per.new--; bump('secret'); } else { counts.new--; per.new--; bump('unreadable'); }
      }
    }
  }
  return { counts, sources: [...bySource.values()], listed, notes };
}

export { exportSource };
