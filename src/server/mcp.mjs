// SPDX-License-Identifier: Apache-2.0
// MCP (JSON-RPC 2.0): one handler shared by HTTP (/mcp) and the stdio proxy.
import { VERSION, VaultError } from '../engine/vault.mjs';
import { PROTOCOL, renderCard } from '../engine/card.mjs';

const S = (props, required = []) => ({ type: 'object', properties: props, required });
const str = (description) => ({ type: 'string', description });
const arr = (description) => ({ type: 'array', items: { type: 'string' }, description });

const TOOLS = new Map();
export function tool(name, description, inputSchema, run, { readOnly = false, localOnly = false } = {}) { TOOLS.set(name, { name, description, inputSchema, run, readOnly, localOnly }); }

tool('memev_session_start', 'Call first in every session (and after a compaction): returns the resume card with the project state, what is already done, the last session, recent decisions and memory relevant to the task.', S({ task: str('One sentence: what the user wants now'), project: str('The project or repository name'), session: str('Your session id, if you know it') }),
  (v, a, c) => { const card = v.sessionStart(c.identity, { task: a.task, project: a.project, client: c.client, session: a.session || c.session }); return { text: `${PROTOCOL}\n\n${renderCard(card)}`, data: card }; }, { readOnly: true });
tool('memev_recall', 'Search memory before answering anything the user may have recorded. Returns exact snippets with their note, related entities and claim status.', S({ query: str('What you need to know'), project: str('Limit or boost to a project'), limit: { type: 'number' } }, ['query']),
  (v, a, c) => ({ data: v.recall(c.identity, { query: a.query, project: a.project, limit: a.limit || 6, client: c.client, session: c.session }) }), { readOnly: true });
tool('memev_remember', 'Save a durable memory the moment it surfaces: a decision, gotcha, fact, pattern, win, person or preference, in the user\'s words.', S({ text: str('The memory'), kind: str('decision | gotcha | fact | pattern | win | person | preference | note'), project: str('Project name'), why: str('The reason, if given') }, ['text']),
  (v, a, c) => ({ data: v.remember(c.identity, { ...a, client: c.client }) }));
tool('memev_checkpoint', 'Record progress after each finished step: the task, what is done, what is in progress, what is next. This is what survives compaction and stops duplicate work.', S({ project: str('Project name'), task: str('The overall task'), done: arr('Steps finished'), doing: str('The step in progress'), next: arr('Steps not started'), files: arr('Files touched') }, ['project']),
  (v, a, c) => ({ data: v.checkpoint(c.identity, { ...a, client: c.client, session: c.session }) }));
tool('memev_get', 'Read one note.', S({ path: str('Note path, e.g. memory/north-star.md') }, ['path']), (v, a, c) => ({ data: v.get(c.identity, a.path) }), { readOnly: true });
tool('memev_list', 'List notes, optionally under a folder.', S({ prefix: str('Folder, e.g. work/active') }), (v, a, c) => ({ data: v.list(c.identity, a.prefix || '') }), { readOnly: true });
tool('memev_write', 'Write a whole note (stored as a small diff when the note exists).', S({ path: str('Note path'), body: str('Markdown') }, ['path', 'body']), (v, a, c) => ({ data: v.write(c.identity, { path: a.path, body: a.body, client: c.client }) }));
tool('memev_append', 'Append text to a note.', S({ path: str('Note path'), text: str('Text to append') }, ['path', 'text']), (v, a, c) => ({ data: v.append(c.identity, { path: a.path, text: a.text, client: c.client }) }));
tool('memev_link', 'Record an explicit connection between two things (related, causes, depends_on, contradicts, derived_from, part_of, supersedes).', S({ from: str('Entity'), to: str('Entity'), type: str('Edge type'), why: str('Why they are connected') }, ['from', 'to']), (v, a, c) => ({ data: v.link(c.identity, { ...a, client: c.client }) }));
tool('memev_claim', 'Add evidence for or against a claim; its status (conjecture, theory, fact, contested, refuted) is recomputed and returned.', S({ subject: str('What the claim is about'), predicate: str('The property or relation'), object: str('The value'), stance: str('support | oppose | speculate'), strength: { type: 'number', description: '0..1' }, path: str('Note that holds the evidence'), text: str('The evidence, quoted') }, ['subject', 'predicate']),
  (v, a, c) => ({ data: v.assert(c.identity, { ...a, client: c.client }) }));
tool('memev_claims', 'List claims with their epistemic status, optionally only one status or one subject.', S({ status: str('fact | theory | conjecture | contested | refuted'), subject: str('Subject') }), (v, a, c) => ({ data: v.claims(c.identity, a) }), { readOnly: true });
tool('memev_graph', 'What an entity is connected to, with the strength and kind of each connection.', S({ entity: str('A name, project or term') }, ['entity']), (v, a) => ({ data: { entity: a.entity, neighbours: v.graph.neighbours(a.entity) } }), { readOnly: true });
tool('memev_explain', 'Explain how two things are connected: the chain of links and the notes that connect them.', S({ from: str('Entity'), to: str('Entity') }, ['from', 'to']), (v, a) => ({ data: v.graph.explain(a.from, a.to) }), { readOnly: true });
tool('memev_provenance', 'Where a memory came from (every operation and commit) and every time a session used it.', S({ path: str('Note path'), heading: str('Section heading'), claim: str('Claim id') }), (v, a, c) => ({ data: v.provenance(c.identity, a) }), { readOnly: true });
tool('memev_feedback', 'Say whether recalled items helped (items are "path#heading" from memev_recall). Recall ranking and the per-prompt bar learn from this.', S({ items: arr('Items from recall'), useful: { type: 'boolean' } }, ['items', 'useful']), (v, a, c) => ({ data: v.feedbackOn(c.identity, { ...a, client: c.client, session: c.session }) }));
tool('memev_tournament_match', 'Record a head-to-head judgement between two competing answers on a topic (designs, explanations, hypotheses). Elo ratings sort them: 1050+ advance, under 950 decompose or drop.', S({ topic: str('What the contenders answer'), a: str('Contender A'), b: str('Contender B'), winner: str('a or b by name; empty for a draw'), round: str('attack | defense | synthesis | evidence'), why: str('The deciding reason') }, ['topic', 'a', 'b']), (v, a, c) => ({ data: v.match(c.identity, { ...a, client: c.client }) }));
tool('memev_tournament_standings', 'Standings for a topic (or the list of topics).', S({ topic: str('Topic') }), (v, a) => ({ data: a.topic ? { topic: a.topic, standings: v.tournament.standings(a.topic) } : { topics: v.tournament.topics() } }), { readOnly: true });
tool('memev_doctor', 'Check Memev itself (log integrity, index, permissions, apps, remote access, backup, disk) and say what to fix. Read-only.', S({}), async (v, a, c) => { const { fileChecks } = await import('../cli/doctor.mjs'); const checks = fileChecks({ root: v.root, vault: v }).map(({ fix, ...x }) => ({ ...x, fix: fix ? fix.desc : null })); return { data: { healthy: !checks.some((x) => x.status === 'fail'), checks } }; }, { readOnly: true });
tool('memev_status', 'Vault health in one call: versions, log, index, graph, memory use.', S({}), (v) => ({ data: v.status() }), { readOnly: true });

export const toolList = () => [...TOOLS.values()].map(({ name, description, inputSchema, readOnly }) => ({ name, description, inputSchema, annotations: { readOnlyHint: readOnly } }));

/** Handle one JSON-RPC message. ctx = { identity, client, session, local }. Returns a response object or null. */
export async function handle(vault, msg, ctx) {
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(-32600, 'invalid request');
  if (msg.id === undefined) return null; // notification
  switch (msg.method) {
    case 'initialize': return reply({ protocolVersion: msg.params?.protocolVersion || '2025-06-18', serverInfo: { name: 'memev', version: VERSION }, capabilities: { tools: { listChanged: false } }, instructions: PROTOCOL });
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: toolList() });
    case 'tools/call': {
      const t = TOOLS.get(msg.params?.name);
      if (!t) return fail(-32602, `unknown tool: ${msg.params?.name}`);
      if (t.localOnly && !ctx.local) return reply({ isError: true, content: [{ type: 'text', text: `${t.name} runs only from this machine, not through the tunnel` }] });
      try {
        const out = await t.run(vault, msg.params.arguments || {}, ctx);
        const text = out.text ?? JSON.stringify(out.data, null, 1);
        return reply({ content: [{ type: 'text', text }], structuredContent: out.data && typeof out.data === 'object' && !Array.isArray(out.data) ? out.data : { result: out.data } });
      } catch (e) {
        if (e instanceof VaultError) return reply({ isError: true, content: [{ type: 'text', text: `${e.code}: ${e.message}` }] });
        return reply({ isError: true, content: [{ type: 'text', text: `error: ${e.message}` }] });
      }
    }
    case 'resources/list': return reply({ resources: [] });
    case 'prompts/list': return reply({ prompts: [] });
    default: return fail(-32601, `method not found: ${msg.method}`);
  }
}
