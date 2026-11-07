// SPDX-License-Identifier: Apache-2.0
// Zero-touch registration in AI apps. For every app found on this machine Memev adds:
//   the MCP server entry, the session hooks (where the app has hooks), and a short instructions block.
// Every file is backed up before the first change; changes merge into what is there (other servers,
// hooks and settings are kept); `memev disconnect` restores the original bytes when the file has not
// changed since, and otherwise removes only Memev's entries.
import fs from 'node:fs';
import path from 'node:path';
import { configDir, homeDir, exists, readJson, writeJson, writeAtomic, sha256, now } from '../engine/util.mjs';
import { VERSION } from '../engine/vault.mjs';
import { changeJsonc } from '../engine/jsonc.mjs';
import { out } from './common.mjs';

const BLOCK_START = '<!-- memev:start -->', BLOCK_END = '<!-- memev:end -->';
const TOML_START = '# memev:start', TOML_END = '# memev:end';
// A table header line in a Codex config.toml. [mcp_servers.memev.x] is a different table and does not match.
const MEMEV_TABLE = /^\[mcp_servers\.memev\]/m;
// The block written into CLAUDE.md, AGENTS.md, GEMINI.md and the like. It repeats no rule: the rules come once per
// session, from the session-start hook or the MCP instructions (src/engine/card.mjs).
export const INSTRUCTIONS = `${BLOCK_START}
## Memory (Memev)
Memev (MCP server "memev") is this person's memory across AI sessions. Its rules and the resume card arrive at session start; if they have not, call memev_session_start first.
${BLOCK_END}`;
// Cursor's always-on project rule: a .mdc file under <project>/.cursor/rules/ with alwaysApply: true is
// injected into every session of that project, so the memory rule is not limited to session start.
const CURSOR_RULE = `---
alwaysApply: true
---
${INSTRUCTIONS}`;

export function platformDirs(env = process.env) {
  const home = homeDir(env);
  const appData = process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : process.platform === 'win32' ? (env.APPDATA || path.join(home, 'AppData', 'Roaming')) : (env.XDG_CONFIG_HOME || path.join(home, '.config'));
  return { home, appData };
}

const isOurs = (cmd) => typeof cmd === 'string' && /memev/.test(cmd) && / hook /.test(cmd);
const hookCmd = (launcher, event, client, format) => `${launcher} hook ${event} --client ${client}${format ? ` --format ${format}` : ''}`;

// Since Node's CVE-2024-27980 fix, a Node app cannot spawn a .cmd file without a shell. On win32 the
// registered command is the absolute node.exe with the runtime script as its first argument, never the
// memev.cmd launcher.
const winSpawn = (env, platform) => platform === 'win32'
  ? { node: path.join(path.dirname(process.execPath), 'node.exe'), script: path.join(configDir(env), 'runtime', VERSION, 'bin', 'memev.mjs') }
  : null;

// matcher-group hooks (Claude Code, Codex, Gemini CLI)
function setGroupHooks(j, events) {
  removeGroupHooks(j);
  j.hooks = j.hooks && typeof j.hooks === 'object' ? j.hooks : {};
  for (const [ev, { matcher, command, timeout }] of Object.entries(events)) {
    j.hooks[ev] = Array.isArray(j.hooks[ev]) ? j.hooks[ev] : [];
    j.hooks[ev].push({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command, timeout }] });
  }
  return j;
}
function removeGroupHooks(j) {
  if (!j.hooks || typeof j.hooks !== 'object') return j;
  for (const ev of Object.keys(j.hooks)) {
    if (!Array.isArray(j.hooks[ev])) continue;
    j.hooks[ev] = j.hooks[ev].map((g) => (g && Array.isArray(g.hooks) ? { ...g, hooks: g.hooks.filter((h) => !isOurs(h?.command)) } : g)).filter((g) => !(g && Array.isArray(g.hooks) && g.hooks.length === 0));
    if (!j.hooks[ev].length) delete j.hooks[ev];
  }
  if (!Object.keys(j.hooks).length) delete j.hooks;
  return j;
}
// flat hooks (Cursor): an entry is a command string or a full entry object (the stop hook carries
// loop_limit, a per-script setting on the hook entry, not something the hook prints)
function setFlatHooks(j, events) {
  j.version ??= 1;
  removeFlatHooks(j);
  j.hooks = j.hooks && typeof j.hooks === 'object' ? j.hooks : {};
  for (const [ev, entry] of Object.entries(events)) {
    const e = typeof entry === 'string' ? { command: entry } : entry;
    j.hooks[ev] = Array.isArray(j.hooks[ev]) ? j.hooks[ev] : [];
    j.hooks[ev].push(e);
  }
  return j;
}
function removeFlatHooks(j) {
  if (!j.hooks || typeof j.hooks !== 'object') return j;
  for (const ev of Object.keys(j.hooks)) { if (!Array.isArray(j.hooks[ev])) continue; j.hooks[ev] = j.hooks[ev].filter((h) => !isOurs(h?.command)); if (!j.hooks[ev].length) delete j.hooks[ev]; }
  if (!Object.keys(j.hooks).length) delete j.hooks;
  return j;
}
const setServer = (key, entry) => (j) => { j[key] = j[key] && typeof j[key] === 'object' ? j[key] : {}; j[key].memev = entry; return j; };
const delServer = (key) => (j) => { if (j[key]) { delete j[key].memev; if (!Object.keys(j[key]).length) delete j[key]; } return j; };
function addBlock(text, block, [s, e] = [BLOCK_START, BLOCK_END]) {
  const t = removeBlock(text, [s, e]);
  return `${t}${t && !t.endsWith('\n') ? '\n' : ''}${t ? '\n' : ''}${block}\n`;
}
function removeBlock(text, [s, e] = [BLOCK_START, BLOCK_END]) {
  const i = text.indexOf(s); if (i < 0) return text;
  const j = text.indexOf(e, i); if (j < 0) return text;
  let before = text.slice(0, i), after = text.slice(j + e.length);
  if (after.startsWith('\n')) after = after.slice(1);
  if (before.endsWith('\n\n') && !after) before = before.slice(0, -1);
  return before + after;
}
// Removing the Cursor rule file: take out Memev's block, and the frontmatter too when Memev wrote the whole file.
const cursorRuleRemove = (t) => {
  const rest = removeBlock(t).replace(/^---\r?\nalwaysApply:\s*true\r?\n---\r?\n?/, '').trim();
  return rest ? `${rest}\n` : '';
};
const tomlEsc = (s) => JSON.stringify(s);
// Codex config.toml: a second [mcp_servers.memev] table would make the file ambiguous, so when the user
// already has one I leave it exactly as-is instead of appending Memev's marked block.
function upsertCodexToml(t, block) {
  const base = removeBlock(t, [TOML_START, TOML_END]);
  if (MEMEV_TABLE.test(base)) return base;
  return addBlock(base, block, [TOML_START, TOML_END]);
}
// The user table is still there after the edit: say so, so the skip is never a silent no-op.
const codexTomlSkipNote = (b) => (b && MEMEV_TABLE.test(removeBlock(b, [TOML_START, TOML_END])) ? 'Codex already has a [mcp_servers.memev] table in config.toml, so Memev left it as-is' : null);

const json = (file, apply, remove, note) => ({ file, kind: 'json', apply, remove, note });
const text = (file, apply, remove, note) => ({ file, kind: 'text', apply, remove, note });
// The Memev tools a consented Claude Code may call without a prompt each time: the memory tools the hooks
// drive every turn, plus the read-only status and why tools. The write and contract tools are left to prompt.
export const MEMEV_TOOLS = ['mcp__memev__memev_recall', 'mcp__memev__memev_remember', 'mcp__memev__memev_checkpoint', 'mcp__memev__memev_status', 'mcp__memev__memev_why'];

const mdBlock = (file) => text(file, (t) => addBlock(t, INSTRUCTIONS), (t) => removeBlock(t));

// Aider has no MCP and no hooks, so the hand-off is a conventions file that .aider.conf.yml lists under
// `read:`, which Aider reads into context at session start. The YAML is edited as text: no parser dependency.
// The read: key comes in three shapes: a block list, a single value (read: FILE) and a flow list
// (read: [a, b]). The two one-line shapes are rewritten into a block list so every file stays listed.
const AIDER_READ_KEY = /^read:\s*$/;
const AIDER_READ_FLOW = /^read:\s*\[(.*)\]\s*$/;
const AIDER_READ_SCALAR = /^read:\s*(\S.*)$/;
const unquote = (s) => { s = s.trim(); if (s.length > 1 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) return s.slice(1, -1); return s; };
const flowItems = (s) => s.split(',').map(unquote).filter(Boolean);
/** The conventions file this Memev install writes for Aider (in the Memev config dir, so it is ours to remove). */
export const AIDER_CONVENTIONS = (env = process.env) => path.join(configDir(env), 'aider-conventions.md');
/** The Aider user config that carries the `read:` list. */
export const AIDER_CONF = (env = process.env) => path.join(homeDir(env), '.aider.conf.yml');
/** The `read:` lines that point at this install's conventions file, in any of the three shapes. */
export function aiderReadEntries(confText, conv = AIDER_CONVENTIONS()) {
  const out = []; let inRead = false;
  for (const line of (confText || '').split('\n')) {
    const flow = AIDER_READ_FLOW.exec(line);
    if (flow) { inRead = false; if (flowItems(flow[1]).includes(conv)) out.push(line); continue; }
    const scalar = AIDER_READ_SCALAR.exec(line);
    if (scalar) { inRead = false; if (unquote(scalar[1]) === conv) out.push(line); continue; }
    if (AIDER_READ_KEY.test(line)) { inRead = true; continue; }
    if (!inRead) continue;
    if (/^\S/.test(line) && !/^-(\s|$)/.test(line)) { inRead = false; continue; } // a new top-level key ends the list
    const m = /^\s*-\s*(.*)$/.exec(line);
    if (m && unquote(m[1]) === conv) out.push(line);
  }
  return out;
}
/** Add the conventions file to the `read:` list once; a second call changes nothing. A one-line read:
 * (a single value or a flow list) is rewritten into a block list that keeps every file already there. */
export function addAiderRead(confText, conv = AIDER_CONVENTIONS()) {
  const text = confText || '';
  if (aiderReadEntries(text, conv).length) return text;
  const lines = text.split('\n');
  const i = lines.findIndex((l) => AIDER_READ_KEY.test(l) || AIDER_READ_FLOW.test(l) || AIDER_READ_SCALAR.test(l));
  if (i < 0) {
    const body = text.trim() ? `${text.replace(/\n*$/, '')}\n\n` : '';
    return `${body}read:\n  - ${conv}\n`;
  }
  const flow = AIDER_READ_FLOW.exec(lines[i]);
  const scalar = flow ? null : AIDER_READ_SCALAR.exec(lines[i]);
  if (flow || scalar) {
    const theirs = flow ? flowItems(flow[1]) : [unquote(scalar[1])];
    lines.splice(i, 1, 'read:', ...[...theirs, conv].map((f) => `  - ${f}`));
    return lines.join('\n');
  }
  // the new entry goes after the last item, at the same indent as the items (YAML allows them at column 0)
  let last = i, indent = null;
  for (let j = i + 1; j < lines.length; j++) {
    const item = /^(\s*)-(\s|$)/.exec(lines[j]);
    if (item) { last = j; if (indent === null) indent = item[1]; continue; }
    if (/^\S/.test(lines[j])) break;
  }
  lines.splice(last + 1, 0, `${indent ?? '  '}- ${conv}`);
  return lines.join('\n');
}
/** Remove the conventions file from the `read:` list; a second call changes nothing. Only our path is
 * taken out: a one-line read: that holds other files is left alone, and one that holds only ours drops. */
export function removeAiderRead(confText, conv = AIDER_CONVENTIONS()) {
  const out = []; let inRead = false;
  for (const line of (confText || '').split('\n')) {
    const flow = AIDER_READ_FLOW.exec(line);
    if (flow) {
      inRead = false;
      const items = flowItems(flow[1]);
      if (!items.includes(conv)) { out.push(line); continue; }
      const rest = items.filter((f) => f !== conv);
      if (rest.length) out.push(`read: [${rest.join(', ')}]`);
      continue;
    }
    const scalar = AIDER_READ_SCALAR.exec(line);
    if (scalar) { inRead = false; if (unquote(scalar[1]) !== conv) out.push(line); continue; }
    if (AIDER_READ_KEY.test(line)) { inRead = true; out.push(line); continue; }
    if (inRead) {
      if (/^\S/.test(line) && !/^-(\s|$)/.test(line)) { inRead = false; out.push(line); continue; }
      const m = /^\s*-\s*(.*)$/.exec(line);
      if (m && unquote(m[1]) === conv) continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/** The apps Memev knows. mode: 'hooks' = state injected by hooks; 'instructions' = MCP + instructions only.
 *  opts.project: the project directory; Cursor gets an always-on rule file in it. */
export function clientDefs(env, bin, platform = process.platform, opts = {}) {
  const { home, appData } = platformDirs(env);
  const win = winSpawn(env, platform);
  const launcher = win ? `"${win.node}" "${win.script}"` : `"${bin}"`;
  const stdio = (id) => win ? { command: win.node, args: [win.script, 'mcp', '--client', id] } : { command: bin, args: ['mcp', '--client', id] };
  // With consent, Claude Code is told it may call Memev's memory tools without a prompt each time: the
  // per-tool entries in permissions.allow (the write and contract tools are left to prompt). Added when
  // allowTools is true, removed when false; disconnect always takes them out again.
  const allowMemev = (j) => {
    j.permissions = j.permissions && typeof j.permissions === 'object' ? j.permissions : {};
    j.permissions.allow = Array.isArray(j.permissions.allow) ? j.permissions.allow : [];
    for (const t of MEMEV_TOOLS) if (!j.permissions.allow.includes(t)) j.permissions.allow.push(t);
    return j;
  };
  const unallowMemev = (j) => {
    if (j.permissions && typeof j.permissions === 'object' && Array.isArray(j.permissions.allow)) {
      j.permissions.allow = j.permissions.allow.filter((e) => e !== 'mcp__memev' && !String(e).startsWith('mcp__memev__'));
      if (!j.permissions.allow.length) delete j.permissions.allow;
      if (!Object.keys(j.permissions).length) delete j.permissions;
    }
    return j;
  };
  // OpenCode takes a local MCP server as a command array in opencode.json
  const opencodeLocal = (id) => ({ type: 'local', command: [...(win ? [win.node, win.script] : [bin]), 'mcp', '--client', id], enabled: true });
  const defs = [
    { id: 'claude-code', name: 'Claude Code', mode: 'hooks', detect: () => exists(path.join(home, '.claude')) || exists(path.join(home, '.claude.json')),
      edits: () => [
        json(path.join(home, '.claude.json'), setServer('mcpServers', { type: 'stdio', ...stdio('claude-code') }), delServer('mcpServers')),
        json(path.join(home, '.claude', 'settings.json'), (j) => (opts.allowTools === true ? allowMemev : opts.allowTools === false ? unallowMemev : (x) => x)(setGroupHooks(j, {
          SessionStart: { matcher: 'startup|resume|clear|compact', command: hookCmd(launcher, 'session-start', 'claude-code'), timeout: 10 },
          UserPromptSubmit: { command: hookCmd(launcher, 'prompt', 'claude-code'), timeout: 10 },
          PreCompact: { command: hookCmd(launcher, 'pre-compact', 'claude-code'), timeout: 15 },
          Stop: { command: hookCmd(launcher, 'stop', 'claude-code'), timeout: 10 },
        })), (j) => unallowMemev(removeGroupHooks(j))),
        mdBlock(path.join(home, '.claude', 'CLAUDE.md')),
      ] },
    { id: 'codex', name: 'Codex CLI', mode: 'hooks', detect: () => exists(path.join(home, '.codex')),
      edits: () => [
        text(path.join(home, '.codex', 'config.toml'), (t) => upsertCodexToml(t, `${TOML_START}\n[mcp_servers.memev]\ncommand = ${tomlEsc(win ? win.node : bin)}\nargs = [${[...(win ? [win.script] : []), 'mcp', '--client', 'codex'].map(tomlEsc).join(', ')}]\n${TOML_END}`), (t) => removeBlock(t, [TOML_START, TOML_END]), codexTomlSkipNote),
        json(path.join(home, '.codex', 'hooks.json'), (j) => setGroupHooks(j, {
          SessionStart: { matcher: 'startup|resume|clear|compact', command: hookCmd(launcher, 'session-start', 'codex'), timeout: 10 },
          UserPromptSubmit: { command: hookCmd(launcher, 'prompt', 'codex'), timeout: 10 },
          PreCompact: { command: hookCmd(launcher, 'pre-compact', 'codex'), timeout: 15 },
          Stop: { command: hookCmd(launcher, 'stop', 'codex'), timeout: 10 },
        }), removeGroupHooks),
        mdBlock(path.join(home, '.codex', 'AGENTS.md')),
      ], manual: 'Codex asks you to trust new hooks once: open /hooks in Codex and trust the Memev hooks.' },
    { id: 'gemini-cli', name: 'Gemini CLI', mode: 'hooks', detect: () => exists(path.join(home, '.gemini')),
      edits: () => [
        json(path.join(home, '.gemini', 'settings.json'), (j) => setGroupHooks(setServer('mcpServers', stdio('gemini-cli'))(j), {
          SessionStart: { matcher: '*', command: hookCmd(launcher, 'session-start', 'gemini-cli', 'gemini'), timeout: 10000 },
          BeforeAgent: { matcher: '*', command: hookCmd(launcher, 'prompt', 'gemini-cli', 'gemini'), timeout: 10000 },
          PreCompress: { matcher: '*', command: hookCmd(launcher, 'pre-compact', 'gemini-cli', 'gemini'), timeout: 15000 },
          AfterAgent: { matcher: '*', command: hookCmd(launcher, 'stop', 'gemini-cli', 'gemini'), timeout: 10000 },
        }), (j) => removeGroupHooks(delServer('mcpServers')(j))),
        mdBlock(path.join(home, '.gemini', 'GEMINI.md')),
      ] },
    { id: 'cursor', name: 'Cursor', mode: 'hooks', detect: () => exists(path.join(home, '.cursor')),
      edits: (o = {}) => [
        json(path.join(home, '.cursor', 'mcp.json'), setServer('mcpServers', stdio('cursor')), delServer('mcpServers')),
        json(path.join(home, '.cursor', 'hooks.json'), (j) => setFlatHooks(j, {
          sessionStart: hookCmd(launcher, 'session-start', 'cursor', 'cursor'),
          beforeSubmitPrompt: hookCmd(launcher, 'prompt', 'cursor', 'cursor'),
          preCompact: hookCmd(launcher, 'pre-compact', 'cursor', 'cursor'),
          stop: { command: hookCmd(launcher, 'stop', 'cursor', 'cursor'), loop_limit: 3 },
        }), removeFlatHooks),
        ...(o.project ? [text(path.join(o.project, '.cursor', 'rules', 'memev.mdc'), (t) => addBlock(t, CURSOR_RULE), cursorRuleRemove)] : []),
      ], manual: 'Check that Settings → MCP shows memev connected, and allow its tools.', note: 'Cursor injects the resume card at session start; per-prompt recall and post-compaction state come through the MCP instructions (Cursor hooks cannot add context to a prompt).' },
    { id: 'claude-desktop', name: 'Claude Desktop', mode: 'instructions', detect: () => exists(path.join(appData, 'Claude')),
      edits: () => [json(path.join(appData, 'Claude', 'claude_desktop_config.json'), setServer('mcpServers', stdio('claude-desktop')), delServer('mcpServers'))] },
    { id: 'windsurf', name: 'Windsurf', mode: 'instructions', detect: () => exists(path.join(home, '.codeium', 'windsurf')),
      edits: () => [json(path.join(home, '.codeium', 'windsurf', 'mcp_config.json'), setServer('mcpServers', stdio('windsurf')), delServer('mcpServers')), mdBlock(path.join(home, '.codeium', 'windsurf', 'memories', 'global_rules.md'))] },
    { id: 'vscode', name: 'VS Code', mode: 'instructions', detect: () => exists(path.join(appData, 'Code', 'User')),
      edits: () => [json(path.join(appData, 'Code', 'User', 'mcp.json'), setServer('servers', { type: 'stdio', ...stdio('vscode') }), delServer('servers'))] },
    { id: 'zed', name: 'Zed', mode: 'instructions', detect: () => exists(path.join(process.platform === 'darwin' ? path.join(home, '.config') : platformDirs(env).appData, 'zed')),
      edits: () => [json(path.join(process.platform === 'darwin' ? path.join(home, '.config') : platformDirs(env).appData, 'zed', 'settings.json'), setServer('context_servers', { source: 'custom', ...stdio('zed') }), delServer('context_servers'))] },
    { id: 'opencode', name: 'OpenCode', mode: 'instructions', detect: () => exists(path.join(home, '.config', 'opencode')),
      edits: () => {
        const mdPath = path.join(home, '.config', 'opencode', 'AGENTS.md');
        const skip = !exists(mdPath) && exists(path.join(home, '.claude', 'CLAUDE.md'));
        // When the user's rules already live in CLAUDE.md, creating the OpenCode rules file would switch them off,
        // so Memev leaves it alone and the protocol arrives through the MCP instructions instead.
        const edits = [json(path.join(home, '.config', 'opencode', 'opencode.json'), setServer('mcp', opencodeLocal('opencode')), delServer('mcp'),
          skip ? () => 'Your rules stay in CLAUDE.md, so Memev left the OpenCode rules file alone; the protocol arrives through the MCP instructions.' : null)];
        if (!skip) edits.push(mdBlock(mdPath));
        return edits;
      } },
    // Grok Build (the terminal agent, command grok) reads ~/.grok/config.toml first, above ~/.claude.json and .mcp.json,
    // so its own [mcp_servers.memev] table gives it its own client id instead of Claude Code's. It names no rules file,
    // so the protocol arrives through the MCP instructions.
    { id: 'grok', name: 'Grok Build', mode: 'instructions', detect: () => exists(path.join(home, '.grok')),
      edits: () => [
        text(path.join(home, '.grok', 'config.toml'), (t) => upsertCodexToml(t, `${TOML_START}\n[mcp_servers.memev]\ncommand = ${tomlEsc(win ? win.node : bin)}\nargs = [${[...(win ? [win.script] : []), 'mcp', '--client', 'grok'].map(tomlEsc).join(', ')}]\n${TOML_END}`), (t) => removeBlock(t, [TOML_START, TOML_END]),
          (b) => (b && MEMEV_TABLE.test(removeBlock(b, [TOML_START, TOML_END])) ? 'Grok Build already has a [mcp_servers.memev] table in config.toml, so Memev left it as-is' : null)),
      ], manual: 'Grok Build has no rules file Memev writes to; the protocol arrives through the MCP instructions. Check it with: grok mcp list' },
    { id: 'copilot-cli', name: 'GitHub Copilot CLI', mode: 'instructions', detect: () => exists(env.COPILOT_HOME || path.join(home, '.copilot')),
      edits: () => {
        const copilotHome = env.COPILOT_HOME || path.join(home, '.copilot');
        const entry = { type: 'local', command: win ? win.node : bin, args: [...(win ? [win.script] : []), 'mcp', '--client', 'copilot-cli'], tools: ['*'] };
        // Copilot CLI reads its user-level instructions from copilot-instructions.md in the same folder
        return [json(path.join(copilotHome, 'mcp-config.json'), setServer('mcpServers', entry), delServer('mcpServers')), mdBlock(path.join(copilotHome, 'copilot-instructions.md'))];
      } },
  ];
  return defs;
}

/** Whether Claude Code's settings.json allows Memev's memory tools right now (any of the per-tool entries in permissions.allow). */
export function claudeToolsAllowed(env = process.env) {
  const { home } = platformDirs(env);
  const j = readJson(path.join(home, '.claude', 'settings.json'), null);
  return !!(j && j.permissions && Array.isArray(j.permissions.allow) && MEMEV_TOOLS.some((t) => j.permissions.allow.includes(t)));
}

/** The apps Memev detects but does not support yet. They are listed as found, not supported, and their files are never changed.
 *  Each app is looked up at the directory its own docs name, which differs per app and per platform. */
export function unsupportedDefs(env) {
  const { home, appData } = platformDirs(env);
  const xdg = env.XDG_CONFIG_HOME || path.join(home, '.config');
  const win = process.platform === 'win32';
  return [
    { id: 'cline', name: 'Cline', detect: () => exists(path.join(home, '.cline')) },
    { id: 'roo', name: 'Roo', detect: () => exists(path.join(home, '.roo')) },
    { id: 'continue', name: 'Continue', detect: () => exists(path.join(home, '.continue')) },
    { id: 'kiro', name: 'Kiro', detect: () => exists(path.join(home, '.kiro')) },
    { id: 'jetbrains-ai', name: 'JetBrains AI', detect: () => exists(path.join(appData, 'JetBrains')) },
    { id: 'amp', name: 'Amp', detect: () => exists(win ? path.join(home, '.config', 'amp') : path.join(xdg, 'amp')) },
    { id: 'goose', name: 'Goose', detect: () => exists(win ? path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Block', 'goose') : path.join(xdg, 'goose')) },
  ];
}

// ---- state: what is connected, what the user declined, and the backups
const stateFile = (env) => path.join(configDir(env), 'clients-state.json');
const loadState = (env) => readJson(stateFile(env), { version: 1, connected: {}, declined: [], files: {} });
const saveState = (env, s) => writeJson(stateFile(env), s, 0o600);
const backupDir = (env) => path.join(configDir(env), 'backups');
const readBytes = (f) => { try { return fs.readFileSync(f); } catch { return null; } };

function plan(def, opts = {}) {
  const changes = [];
  for (const e of def.edits(opts)) {
    const before = readBytes(e.file);
    let after;
    if (e.kind === 'json') {
      const text = before ? before.toString('utf8') : '';
      let obj = {};
      if (text.trim()) { try { obj = JSON.parse(text); } catch { obj = undefined; } }
      if (obj === undefined) { // comments or trailing commas (VS Code, Zed): change the text in place, so they stay
        try { after = Buffer.from(changeJsonc(text, e.apply)); } catch (err) { return { error: err.message, file: e.file }; }
      } else {
        if (typeof obj !== 'object' || Array.isArray(obj) || obj === null) return { error: 'is not a JSON object', file: e.file };
        after = Buffer.from(`${JSON.stringify(e.apply(obj), null, 2)}\n`);
      }
    } else after = Buffer.from(e.apply(before ? before.toString('utf8') : ''));
    changes.push({ e, before, after });
  }
  return { changes };
}

export function connect(id, { env = process.env, launcher, dryRun = false, platform = process.platform, project = null, allowTools } = {}) {
  const proj = project ? path.resolve(String(project)) : null;
  const def = clientDefs(env, launcher, platform, { project: proj, allowTools }).find((d) => d.id === id);
  if (!def) throw new Error(`unknown app: ${id}`);
  const p = plan(def, { project: proj });
  if (p.error) return { id, name: def.name, status: 'needs-manual', reason: `${p.file} ${p.error}`, file: p.file, problem: p.error };
  const st = loadState(env);
  const changed = p.changes.filter((c) => !c.before || !c.before.equals(c.after));
  const notes = p.changes.map((c) => (c.e.note ? c.e.note(c.before ? c.before.toString('utf8') : '') : null)).filter(Boolean);
  if (dryRun) return { id, name: def.name, status: 'would-change', files: changed.map((c) => c.e.file), notes };
  for (const c of changed) {
    const rec = st.files[c.e.file];
    if (rec && c.before && sha256(c.before) !== rec.after_sha) rec.stale_backup = true; // edited since: never roll those edits back
    if (!rec) {
      let backup = null;
      if (c.before) { fs.mkdirSync(backupDir(env), { recursive: true, mode: 0o700 }); backup = path.join(backupDir(env), `${id}-${sha256(c.e.file).slice(0, 8)}-${path.basename(c.e.file)}.${Date.now()}.bak`); fs.writeFileSync(backup, c.before, { mode: 0o600 }); }
      st.files[c.e.file] = { client: id, kind: c.e.kind, existed: !!c.before, before_sha: c.before ? sha256(c.before) : null, backup, at: now() };
    }
    let mode = 0o644; try { mode = fs.statSync(c.e.file).mode & 0o777; } catch {}
    writeAtomic(c.e.file, c.after, mode);
    st.files[c.e.file].after_sha = sha256(c.after);
  }
  for (const c of p.changes) if (st.files[c.e.file] && !changed.includes(c)) st.files[c.e.file].after_sha ??= sha256(c.after);
  st.connected[id] = { at: now(), mode: def.mode, launcher, project: proj };
  st.declined = st.declined.filter((x) => x !== id);
  saveState(env, st);
  return { id, name: def.name, status: changed.length ? 'added' : 'already', mode: def.mode, files: changed.map((c) => c.e.file), manual: def.manual || null, note: def.note || null, notes };
}

/** What connect adds to each of an app's files, to paste by hand when Memev cannot edit one: memev connect <app> --print. */
export function snippets(id, { env = process.env, launcher, platform = process.platform, project = null } = {}) {
  const def = clientDefs(env, launcher, platform, { project: project ? path.resolve(String(project)) : null }).find((d) => d.id === id);
  if (!def) throw new Error(`unknown app: ${id}`);
  return { name: def.name, files: def.edits({ project: project ? path.resolve(String(project)) : null }).map((e) => ({ file: e.file, kind: e.kind, text: e.kind === 'json' ? `${JSON.stringify(e.apply({}), null, 2)}\n` : e.apply('') })) };
}

/**
 * Write the resume card to Aider's conventions file and make sure .aider.conf.yml reads it. Aider has no MCP,
 * so this is the whole hand-off. Idempotent: the card file is rewritten to the current card, the read entry
 * is added once. `memev disconnect aider` removes both (restoring the config if it had other content).
 */
export function aiderHandoff({ env = process.env, cardText } = {}) {
  const conv = AIDER_CONVENTIONS(env);
  const conf = AIDER_CONF(env);
  const st = loadState(env);
  const cardFile = cardText.endsWith('\n') ? cardText : `${cardText}\n`;
  const ensure = (file, before) => {
    if (st.files[file]) { if (before && sha256(before) !== st.files[file].after_sha) st.files[file].stale_backup = true; return; }
    let backup = null;
    if (before) { fs.mkdirSync(backupDir(env), { recursive: true, mode: 0o700 }); backup = path.join(backupDir(env), `aider-${sha256(file).slice(0, 8)}-${path.basename(file)}.${Date.now()}.bak`); fs.writeFileSync(backup, before, { mode: 0o600 }); }
    st.files[file] = { client: 'aider', kind: 'text', existed: !!before, before_sha: before ? sha256(before) : null, backup, at: now() };
  };
  const convBefore = readBytes(conv);
  ensure(conv, convBefore);
  writeAtomic(conv, cardFile, 0o644);
  st.files[conv].after_sha = sha256(Buffer.from(cardFile));
  const confBefore = readBytes(conf);
  const confText = confBefore ? confBefore.toString('utf8') : '';
  const confAfter = addAiderRead(confText, conv);
  ensure(conf, confBefore);
  if (confAfter !== confText) { let mode = 0o644; try { mode = fs.statSync(conf).mode & 0o777; } catch {} writeAtomic(conf, confAfter, mode); }
  st.files[conf].after_sha = sha256(Buffer.from(confAfter));
  st.connected['aider'] = { at: now(), mode: 'instructions', launcher: 'memev' };
  st.declined = st.declined.filter((x) => x !== 'aider');
  saveState(env, st);
  return { conventions: conv, conf, added: confAfter !== confText };
}

export function disconnect(id, { env = process.env, launcher, decline = true, platform = process.platform } = {}) {
  const st = loadState(env);
  if (id === 'aider') return disconnectAider(env, st, decline);
  const defs = clientDefs(env, launcher || st.connected[id]?.launcher || 'memev', platform, { project: st.connected[id]?.project || null });
  const def = defs.find((d) => d.id === id);
  const results = [];
  for (const [file, rec] of Object.entries(st.files)) {
    if (rec.client !== id) continue;
    const cur = readBytes(file);
    if (cur && sha256(cur) === rec.after_sha && !rec.stale_backup) {
      if (rec.existed) { writeAtomic(file, fs.readFileSync(rec.backup), fs.statSync(file).mode & 0o777); results.push({ file, action: 'restored' }); }
      else { fs.rmSync(file, { force: true }); results.push({ file, action: 'removed' }); }
    } else if (cur && def) {
      const e = def.edits().find((x) => x.file === file);
      let next;
      if (e.kind === 'json') {
        const text = cur.toString('utf8'); let obj;
        try { obj = JSON.parse(text); } catch {}
        try { next = obj === undefined ? changeJsonc(text, e.remove) : `${JSON.stringify(e.remove(obj), null, 2)}\n`; } catch { results.push({ file, action: 'needs-manual' }); continue; }
      }
      else next = e.remove(cur.toString('utf8'));
      if (!rec.existed && (next.trim() === '{}' || next.trim() === '')) fs.rmSync(file, { force: true });
      else writeAtomic(file, next, fs.statSync(file).mode & 0o777);
      results.push({ file, action: 'memev entries removed (the file changed since, so the rest was kept)' });
    } else results.push({ file, action: 'gone already' });
    delete st.files[file];
  }
  delete st.connected[id];
  if (decline && !st.declined.includes(id)) st.declined.push(id);
  saveState(env, st);
  return { id, results };
}

/** Tear down the Aider hand-off: the conventions file is Memev's, so it is removed; the config is restored
 * to its original bytes when unchanged, otherwise only the read entry is taken out. */
function disconnectAider(env, st, decline) {
  const conv = AIDER_CONVENTIONS(env);
  const conf = AIDER_CONF(env);
  const remove = (file) => (file === conf ? (t) => removeAiderRead(t, conv) : () => '');
  const results = [];
  for (const [file, rec] of Object.entries(st.files)) {
    if (rec.client !== 'aider') continue;
    const cur = readBytes(file);
    if (cur && sha256(cur) === rec.after_sha && !rec.stale_backup) {
      if (rec.existed) { writeAtomic(file, fs.readFileSync(rec.backup), fs.statSync(file).mode & 0o777); results.push({ file, action: 'restored' }); }
      else { fs.rmSync(file, { force: true }); results.push({ file, action: 'removed' }); }
    } else if (cur) {
      let next;
      try { next = remove(file)(cur.toString('utf8')); } catch { results.push({ file, action: 'needs-manual' }); continue; }
      if (!rec.existed && next.trim() === '') fs.rmSync(file, { force: true });
      else writeAtomic(file, next, fs.statSync(file).mode & 0o777);
      results.push({ file, action: 'memev entries removed (the file changed since, so the rest was kept)' });
    } else results.push({ file, action: 'gone already' });
    delete st.files[file];
  }
  delete st.connected['aider'];
  if (decline && !st.declined.includes('aider')) st.declined.push('aider');
  saveState(env, st);
  return { id: 'aider', results };
}

// What each app needs before it uses Memev: apps load MCP servers and hooks when a session starts, so the
// session that ran init does not have it yet.
export const RESTART = {
  'claude-code': 'Start a new Claude Code session', codex: 'Start a new Codex CLI session', 'gemini-cli': 'Start a new Gemini CLI session',
  cursor: 'Open a new Cursor chat', 'claude-desktop': 'Quit and reopen Claude Desktop', windsurf: 'Quit and reopen Windsurf',
  vscode: 'Reload the VS Code window (Developer: Reload Window)', zed: 'Quit and reopen Zed',
  opencode: 'Quit and reopen OpenCode', 'copilot-cli': 'Start a new Copilot CLI session',
};
// Apps whose session-start hook brings the protocol, so their MCP instructions need not repeat it.
export const HOOK_CLIENTS = new Set(clientDefs({}, 'memev').filter((d) => d.mode === 'hooks').map((d) => d.id));
export function detect(env = process.env, launcher = 'memev', platform = process.platform) {
  const st = loadState(env);
  const supported = clientDefs(env, launcher, platform).map((d) => ({ id: d.id, name: d.name, mode: d.mode, found: !!d.detect(), connected: !!st.connected[d.id], declined: st.declined.includes(d.id), note: d.note || null, manual: d.manual || null, restart: RESTART[d.id] || `Restart ${d.name}`, supported: true }));
  const unsupported = unsupportedDefs(env).map((d) => ({ id: d.id, name: d.name, found: !!d.detect(), supported: false }));
  return [...supported, ...unsupported];
}

/** Connect every app that is installed and not yet connected (and not declined, unless forced). Apps that are found but not supported yet are left alone. */
export function connectAll({ env = process.env, launcher, force = false, platform = process.platform, project = null, allowTools } = {}) {
  return detect(env, launcher, platform).filter((c) => c.found && c.supported && (force || !c.declined)).map((c) => { try { return connect(c.id, { env, launcher, platform, project, allowTools }); } catch (e) { return { id: c.id, name: c.name, status: 'failed', reason: e.message }; } });
}

export function launcherPath(env = process.env) { return path.join(configDir(env), 'bin', process.platform === 'win32' ? 'memev.cmd' : 'memev'); }

export async function command(cmd, pos, flags, { env, root }) {
  const launcher = launcherPath(env);
  if (!exists(launcher)) { const { installRuntime } = await import('./main.mjs'); installRuntime(env); }
  const target = pos[0] || 'all';
  if (cmd === 'clients') {
    for (const c of detect(env, launcher)) console.log(`  ${c.connected ? '\u2713' : c.found ? '\u00b7' : ' '} ${c.name.padEnd(15)} ${c.found ? (c.supported ? (c.connected ? `connected (${c.mode === 'hooks' ? 'hooks + MCP' : 'MCP + instructions'})` : c.declined ? 'found, disconnected by you' : 'found, not connected') : 'found, not supported yet') : 'not found'}`);
    return 0;
  }
  if (cmd === 'connect' && flags.print) {
    const id = typeof flags.print === 'string' ? flags.print : pos[0];
    if (!id) throw new Error('memev connect <app> --print  (memev clients lists the apps)');
    const s = snippets(id, { env, launcher, project: flags.project });
    console.log(`${s.name}: what Memev adds, to paste by hand. Nothing was changed.`);
    for (const f of s.files) console.log(`\n${f.kind === 'json' ? `In ${f.file}, merge this into the JSON object that is there:` : `In ${f.file}, add this block:`}\n${f.text.trimEnd()}`);
    return 0;
  }
  if (cmd === 'connect') {
    if (target !== 'all') {
      const c = detect(env, launcher).find((x) => x.id === target);
      if (c && c.found && !c.supported) { out.info(`${c.name}: found, not supported yet (see docs/CLIENTS.md to ask for it)`); return 0; }
    }
    // the stored consent (the init question or an earlier --allow-tools) keeps applying: a plain connect
    // re-adds the entries after a disconnect, and the flag still forces them on or off
    const v = flags['no-allow-tools'] ? false : flags['allow-tools'];
    const explicit = v === undefined ? undefined : !/^(false|no|off|0)$/i.test(String(v));
    const ob = await import('./onboarding.mjs');
    if (explicit !== undefined && !flags['dry-run']) ob.setAllowTools(env, explicit);
    const allowTools = explicit ?? (ob.allowToolsSettings(env).enabled || undefined);
    const res = target === 'all' ? connectAll({ env, launcher, force: !!flags.force, project: flags.project, allowTools }) : [connect(target, { env, launcher, dryRun: !!flags['dry-run'], project: flags.project, allowTools })];
    if (!res.length) {
      const unsup = detect(env, launcher).filter((c) => c.found && !c.supported);
      if (unsup.length) { console.log(`Found ${unsup.map((c) => c.name).join(', ')} but Memev does not support ${unsup.length > 1 ? 'them' : 'it'} yet (see docs/CLIENTS.md to ask for it).`); return 0; }
    }
    if (!res.length) console.log('No AI apps found. Install one (Codex, Cursor, Gemini CLI, Windsurf, VS Code, Zed, OpenCode, GitHub Copilot CLI, or a Claude product) and run memev connect again.');
    for (const r of res) {
      if (r.status === 'added') out.ok(`${r.name}: connected (${r.mode === 'hooks' ? 'hooks + MCP + instructions' : 'MCP + instructions'})`);
      else if (r.status === 'already') out.ok(`${r.name}: already connected`);
      else if (r.status === 'would-change') out.info(`${r.name}: would change ${r.files.join(', ') || 'nothing'}`);
      else out.bad(`${r.name}: ${r.reason}`);
      if (r.status === 'needs-manual' && r.file) out.info(`add it by hand: memev connect ${r.id} --print shows what to paste`);
      if (r.manual) out.warn(r.manual);
      for (const n of r.notes || []) out.warn(n);
    }
    const ids = res.filter((r) => ['added', 'already'].includes(r.status)).map((r) => r.id);
    if (ids.length && !flags['dry-run']) await seatOnBus({ root, env, ids, flags });
    // connecting every app is what the background connect does, so asking for it turns that back on after memev init --no-connect;
    // memev connect <app> leaves it off, so one yes connects one app (issue 284)
    if (target === 'all' && !flags['dry-run'] && !flags.project && root) {
      const f = path.join(root, '.memev', 'config.json'); const c = readJson(f, null);
      if (c?.clients?.auto_connect === false) { delete c.clients.auto_connect; writeJson(f, c, 0o600); out.info('Memev connects AI apps it finds from now on (memev init --no-connect had turned that off)'); }
    }
    return res.some((r) => r.status === 'failed' || (target !== 'all' && r.status === 'needs-manual')) ? 1 : 0;
  }
  if (cmd === 'disconnect' || cmd === 'uninstall') {
    const st = loadState(env);
    const ids = target === 'all' || cmd === 'uninstall' ? Object.keys(st.connected) : [target];
    for (const id of ids) { const r = disconnect(id, { env, launcher }); console.log(`  ${id}:`); for (const x of r.results) out.info(`${x.action}: ${x.file}`); }
    if (cmd === 'uninstall') {
      const { resolveRoot } = await import('./common.mjs'); const { stopDaemon } = await import('./daemon.mjs');
      const root = resolveRoot(flags.root, env); try { await stopDaemon(root); } catch {}
      try { const svc = await import('./service.mjs'); await svc.removeService({ env, quiet: true }); } catch {}
      console.log(`Memev is disconnected and stopped. Your vault at ${root} is untouched${flags.purge ? '' : '; delete it yourself if you no longer want it'}.`);
      if (flags.purge) { fs.rmSync(path.join(configDir(env), 'runtime'), { recursive: true, force: true }); fs.rmSync(path.join(configDir(env), 'bin'), { recursive: true, force: true }); console.log('Removed the runtime copy and launcher.'); }
    }
    return 0;
  }
  return 2;
}

/** After connect: each app gets its seat on the comms bus straight away (here, or on the vault this computer joined). */
async function seatOnBus({ root, env, ids, flags }) {
  const { isVault } = await import('../engine/vault.mjs');
  try {
    if (root && isVault(root)) {
      const bus = await import('./bus-cli.mjs');
      const r = await bus.setupBus({ root, env, clients: ids, flags });
      if (r.ok) out.ok(`on the comms bus: ${r.seats.join(', ')} (each joins on its first session)`); else out.bad(`comms bus: ${r.problems.join('; ')}`);
      for (const n of r.notes || []) out.warn(n);
      if (r.operator) out.ok(`${r.operator} leads the others`); else out.warn(bus.LEAD_LATER);
      return;
    }
    const { loadRemote, remoteFetch } = await import('./remote.mjs');
    const remote = loadRemote(env); if (!remote) return;
    const b = await remoteFetch(remote, 'v1/bus-register', { body: { clients: ids }, env });
    if (b.ok) out.ok(`on the comms bus: ${b.json.seats.join(', ')}`); else out.bad(`comms bus: the vault answered ${b.status}`);
  } catch (e) { out.bad(`comms bus: ${e.message}`); }
}
