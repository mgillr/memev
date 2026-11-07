// SPDX-License-Identifier: Apache-2.0
// The two chat export formats, read field by field into one conversation shape:
//   { id, title, created, updated, project, turns: [{ role: 'user' | 'assistant', text, at }] }
// Neither vendor publishes a schema; the shapes follow the parsers and format notes listed in docs/IMPORT.md.
// Every field is optional: a missing one leaves a gap, never a throw.

const TOOL_LINE_MAX = 80;

const iso = (t) => {
  if (t === null || t === undefined || t === '') return null;
  if (typeof t === 'number' && Number.isFinite(t)) return new Date(t > 1e12 ? t : t * 1000).toISOString(); // seconds, or milliseconds
  const d = new Date(String(t));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const short = (s, n = TOOL_LINE_MAX) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export function detectFormat(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  if (obj.mapping && typeof obj.mapping === 'object') return 'chatgpt';
  if (Array.isArray(obj.chat_messages)) return 'claude';
  return null;
}

// ---- ChatGPT: a mapping of nodes {id, message, parent}; the shown branch runs from current_node up to the root.
// Nodes in recent exports carry no children list, so the tree is walked by parent only. When current_node is missing
// or names no node, the newest leaf (a node no other node points at) stands in for it.
function chatgptPath(mapping, current) {
  const nodes = mapping || {};
  let leaf = current && nodes[current] ? current : null;
  if (!leaf) {
    const parents = new Set(Object.values(nodes).map((n) => n && n.parent).filter(Boolean));
    let best = null, bestT = -Infinity;
    for (const [id, n] of Object.entries(nodes)) {
      if (parents.has(id)) continue;
      const t = Number(n?.message?.create_time) || 0;
      if (t >= bestT) { best = id; bestT = t; }
    }
    leaf = best;
  }
  const chain = [];
  const seen = new Set();
  for (let id = leaf; id && nodes[id] && !seen.has(id); id = nodes[id].parent) { seen.add(id); chain.push(nodes[id]); }
  return chain.reverse();
}

function chatgptPartText(p) {
  if (typeof p === 'string') return p;
  if (!p || typeof p !== 'object') return '';
  if (p.content_type === 'text' && typeof p.text === 'string') return p.text;
  if (p.content_type === 'audio_transcription' && typeof p.text === 'string') return p.text;
  if (/asset_pointer$/.test(p.content_type || '')) return `[${String(p.content_type).replace(/_asset_pointer$/, '').replace(/_/g, ' ')} attached]`;
  return '';
}

const CHATGPT_HIDDEN = new Set(['user_editable_context', 'model_editable_context', 'about_user_message', 'about_model_message', 'tether_browsing_display', 'tether_browsing_code', 'sonic_webpage', 'system_error', 'thoughts', 'reasoning_recap']);

export function chatgptConversation(c) {
  const turns = [];
  for (const node of chatgptPath(c.mapping, c.current_node)) {
    const m = node?.message;
    if (!m) continue;
    if (m.metadata?.is_visually_hidden_from_conversation === true) continue;
    const role = m.author?.role;
    const ct = m.content?.content_type;
    if (CHATGPT_HIDDEN.has(ct)) continue;
    const at = iso(m.create_time);
    if (role === 'tool') {
      // a tool's output (browsing, code run, file search): one short line, never its body
      const name = m.author?.name || ct || 'tool';
      turns.push({ role: 'tool', text: `[tool output: ${short(name)}]`, at });
      continue;
    }
    if (role !== 'user' && role !== 'assistant') continue;
    let text = '';
    if (Array.isArray(m.content?.parts)) text = m.content.parts.map(chatgptPartText).filter(Boolean).join('\n');
    else if (ct === 'code' && typeof m.content?.text === 'string') {
      // the assistant writing a call to a tool (recipient is the tool), or code shown in the chat
      text = m.recipient && m.recipient !== 'all' ? `[tool call: ${short(m.recipient)}]` : '```' + (m.content.language || '') + '\n' + m.content.text + '\n```';
    } else if (ct === 'tether_quote') text = `> ${short(m.content.title || m.content.url || '', 200)}\n${m.content.text || ''}`.trim();
    else if (typeof m.content?.text === 'string') text = m.content.text;
    if (role === 'assistant' && m.recipient && m.recipient !== 'all' && ct !== 'code') text = `[tool call: ${short(m.recipient)}]`;
    if (!String(text).trim()) continue;
    turns.push({ role, text: String(text).trim(), at });
  }
  const id = String(c.conversation_id || c.id || '');
  const gizmo = typeof c.gizmo_id === 'string' && c.gizmo_id.startsWith('g-p-') ? c.gizmo_id : null; // a ChatGPT Project
  return { id, title: String(c.title || '').trim() || null, created: iso(c.create_time), updated: iso(c.update_time), project: gizmo, turns };
}

// ---- Claude: chat_messages in order, sender 'human' or 'assistant', content blocks of text, thinking, tool_use,
// tool_result; older exports carry only the message's text.
export function claudeConversation(c, { projects = null } = {}) {
  const turns = [];
  for (const m of c.chat_messages || []) {
    if (!m || typeof m !== 'object') continue;
    const role = m.sender === 'human' ? 'user' : m.sender === 'assistant' ? 'assistant' : null;
    if (!role) continue;
    const at = iso(m.created_at);
    const lines = [];
    if (Array.isArray(m.content) && m.content.length) {
      for (const b of m.content) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) lines.push(b.text.trim());
        else if (b.type === 'tool_use') lines.push(`[tool call: ${short(b.name || 'tool')}${b.input?.title ? `: ${short(b.input.title, 60)}` : ''}]`);
        else if (b.type === 'tool_result') lines.push(`[tool output: ${short(b.name || 'tool')}]`);
        // thinking and token_budget blocks are left out
      }
    } else if (typeof m.text === 'string' && m.text.trim()) lines.push(m.text.trim());
    for (const a of Array.isArray(m.attachments) ? m.attachments : []) if (a?.file_name) lines.push(`[attachment: ${short(a.file_name)}]`);
    for (const f of Array.isArray(m.files) ? m.files : []) if (f?.file_name) lines.push(`[file: ${short(f.file_name)}]`);
    if (!lines.length) continue;
    turns.push({ role, text: lines.join('\n'), at });
  }
  const project = c.project_uuid ? (projects?.get(c.project_uuid) || c.project_uuid) : null;
  return { id: String(c.uuid || ''), title: String(c.name || '').trim() || null, created: iso(c.created_at), updated: iso(c.updated_at), project, turns };
}

export { iso, short };
