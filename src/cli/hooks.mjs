// SPDX-License-Identifier: Apache-2.0
// Session hooks. They run inside the AI client before and after turns, so they must be fast and must
// never break the session: every failure is swallowed (fail open) and the hook exits 0.
//   session-start  → the resume card goes into context before the first turn (and after compaction)
//   prompt         → the prompt is recorded; memory relevant to it is injected (recall without asking)
//   pre-compact    → progress is checkpointed from the transcript before the context is cut
//   stop           → the reply is recorded; the todo list becomes a checkpoint when it changed
// session-start and prompt also check the comms bus: a heartbeat, a hello the first time, and any
// new messages or a hold go into context.
// Cursor's stop hook can only continue the session with a followup_message, so it is reserved for
// operator tasks waiting on this seat. The loop limit is a setting on the stop entry in hooks.json
// (loop_limit, default 5 there), and the hook itself stops following up once loop_count reaches it.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { api, clientToken, resolveRoot } from './common.mjs';
import { ensureDaemon } from './daemon.mjs';
import { scanTranscript, todosToCheckpoint } from './transcript.mjs';
import { readJson, writePrivateJson, sha256, slug, configDir } from '../engine/util.mjs';
import { isVault } from '../engine/vault.mjs';
import { PROTOCOL } from '../engine/card.mjs';

function readStdin() { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } }
export function projectOf(cwd) {
  if (!cwd) return null;
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', timeout: 1500 });
  return slug(path.basename(r.status === 0 && r.stdout.trim() ? r.stdout.trim() : cwd));
}

// Output shapes: Claude Code and Codex share one; Gemini CLI uses it with its own event names;
// Cursor takes { additional_context } at session start only.
const GEMINI = { SessionStart: 'SessionStart', UserPromptSubmit: 'BeforeAgent' };
function emit(format, event, context) {
  if (!context) return;
  if (format === 'plain') { process.stdout.write(`${context}\n`); return; }
  if (format === 'cursor') { if (event === 'SessionStart') process.stdout.write(JSON.stringify({ additional_context: context })); return; }
  const name = format === 'gemini' ? GEMINI[event] || event : event;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: name, additionalContext: context } }));
}

// A request to build something: the session is reminded to turn it into a signed contract first.
const BUILD_RE = /\b(i have a (new )?project|build (me|us)\b|(build|make|create|write|implement|develop|set up) (me |us )?(an? |the )?[\w -]{0,40}\b(app|application|tool|cli|api|service|site|website|bot|library|script|feature|game|dashboard|server|extension|plugin|pipeline))/i;
export const isBuildRequest = (p) => BUILD_RE.test(String(p || ''));
// A prompt that only moves the conversation on: under 4 words, or a continuation phrase. Recall has nothing to match
// it against, so the hook does not recall for it.
const CONTINUATION = /^(continue|go on|go ahead|carry on|keep going|yes|yes please|yep|yeah|ok|okay|sure|thanks|thank you|fix it|do it|next|proceed|please continue)[\s.!]*$/i;
export const isContinuation = (p) => { const s = String(p || '').trim(); return s.split(/\s+/).filter(Boolean).length < 4 || CONTINUATION.test(s); };
const BUILD_NUDGE = '[Memev] This is a build request. Before writing code: infer the requirements, call memev_contract_from_request (each requirement with a local check), then memev_contract_sign, and say in one line what you signed. If an open contract already covers it, use memev_contract_status instead.';

export async function runHook(event, flags, env = process.env) {
  const format = flags.format || 'claude';
  let input = {}; try { input = JSON.parse(readStdin() || '{}'); } catch {}
  const root = resolveRoot(flags.root, env);
  const client = String(flags.client || 'claude-code');
  const session = String(input.session_id || input.sessionId || input.conversation_id || env.MEMEV_SESSION || 'session').slice(0, 64);
  const project = flags.project || projectOf(input.cwd || input.workspace_roots?.[0] || process.cwd());
  const { loadRemote, remoteFetch } = await import('./remote.mjs');
  const remote = !isVault(root) ? loadRemote(env) : null; // this computer uses a vault elsewhere (memev join)
  const stateFile = remote ? path.join(configDir(env), 'hooks', `${slug(session, 64)}.json`) : path.join(root, '.memev', 'hooks', `${slug(session, 64)}.json`);
  const st = readJson(stateFile, { offset: 0, todos: null });
  try {
    let call;
    if (remote) call = (route, body) => remoteFetch(remote, `v1/${route}`, { body: { session, project, ...body }, env, headers: { 'x-memev-client': client }, timeoutMs: 8000 }).then((r) => { if (!r.ok) throw new Error(`${route}: ${r.status}`); return r.json; });
    else {
      if (!(await ensureDaemon(root, { quiet: true }))) throw new Error('daemon not reachable');
      const token = clientToken(root, client);
      call = (route, body) => api(root, `/v1/${route}`, { body: { session, project, ...body }, token, timeoutMs: 4000 }).then((r) => { if (!r.ok) throw new Error(`${route}: ${r.status}`); return r.json; });
    }
    const tr = input.transcript_path ? scanTranscript(input.transcript_path, { fromOffset: st.offset }) : null;
    const saveCheckpoint = async (source) => {
      const cp = todosToCheckpoint(tr?.todos);
      const h = cp ? sha256(JSON.stringify(cp)) : null;
      if (cp && h !== st.todos) { await call('checkpoint', { ...cp, task: st.task || undefined, files: tr.files, source }); st.todos = h; return true; }
      if (source === 'pre-compact') { await call('checkpoint', { task: st.task || undefined, doing: tr?.lastUser ? `answering: ${tr.lastUser.slice(0, 300)}` : null, files: tr?.files || [], source }); return true; }
      return false;
    };
    if (event === 'session-start') {
      const source = input.source || 'startup';
      // a compaction or a clear empties the context; a resume brings the earlier conversation back, card included
      if (source === 'compact' || source === 'clear') { st.injected = []; st.card = null; }
      const fresh = source !== 'compact' && source !== 'resume'; // startup or clear: a new context, so the rules as well
      const r = await call('session-start', { task: null });
      // whether the person still has to pick a lead: only at a fresh start, and only until the setup session has asked
      // (bus/operator.json records it)
      const asked = remote ? null : readJson(path.join(root, 'bus', 'operator.json'), null)?.asked;
      const bus = await call('bus-pulse', { lead: fresh && !(typeof asked === 'string' && asked) }).catch(() => null);
      await call('journal', { role: 'event', text: `session ${source} (${client}${project ? `, ${project}` : ''})` }).catch(() => {});
      // the card goes in when the context does not hold it: at a fresh start, after a compaction, or when it changed
      const card = sha256(String(r.text || ''));
      const parts = [fresh ? r.protocol || PROTOCOL : '', fresh || card !== st.card ? r.text : '', bus?.text || ''].filter(Boolean);
      st.card = card;
      emit(format, 'SessionStart', parts.join('\n\n'));
    } else if (event === 'prompt') {
      const prompt = String(input.prompt || input.user_prompt || '').trim();
      if (prompt) {
        if (!st.task) st.task = prompt.slice(0, 200);
        // never the same item twice in a session: the route leaves out what this session was already given
        const r = isContinuation(prompt) ? null : await call('recall', { query: prompt.slice(0, 1000), limit: 4, exclude: st.injected || [] });
        if (r?.hits?.length) st.injected = [...new Set([...(st.injected || []), ...r.hits.map((h) => `${h.path}#${h.heading || ''}`)])].slice(-500);
        // Cursor cannot show prompt context anyway, so it only peeks: a task that is already waiting
        // when the person types must stay unread for the stop hook's follow-up, not be swallowed here
        const bus = await call('bus-pulse', { peek: format === 'cursor' }).catch(() => null);
        await call('journal', { role: 'user', text: prompt });
        emit(format, 'UserPromptSubmit', [bus?.text, r?.text, isBuildRequest(prompt) ? BUILD_NUDGE : ''].filter(Boolean).join('\n\n'));
      }
    } else if (event === 'pre-compact') {
      await saveCheckpoint('pre-compact');
      if (tr?.lastAssistant) await call('journal', { role: 'assistant', text: tr.lastAssistant });
    } else if (event === 'stop') {
      const reply = input.last_assistant_message || input.prompt_response || tr?.lastAssistant;
      if (reply) await call('journal', { role: 'assistant', text: reply });
      await saveCheckpoint('auto');
      if (format === 'claude' && !input.stop_hook_active) {
        const g = await call('contract-gate', {});
        if (g.open?.length) process.stdout.write(JSON.stringify({ decision: 'block', reason: `You signed ${g.open.map((c) => `${c.id} (${c.title})`).join(', ')} and it is not verified yet. Finish the remaining criteria and run memev_contract_verify, or report exactly what blocks you.` }));
      }
      // loop_count 3 is the loop_limit set on the stop entry in hooks.json: at that point Cursor
      // would loop anyway, so the hook stops following up
      if (format === 'cursor' && Number(input.loop_count ?? 0) < 3) {
        const u = await call('bus-pulse', { peek: true }).catch(() => null);
        const waiting = (u?.messages || []).filter((m) => m.type === 'task' && m.operator);
        if (waiting.length) {
          await call('bus-pulse', {}).catch(() => null); // the follow-up claims these tasks, so they are read
          const lines = waiting.slice(-3).map((m) => `#${m.seq} ${String(m.body).slice(0, 300)}`);
          process.stdout.write(JSON.stringify({
            followup_message: `[Memev] The operator has ${waiting.length} task${waiting.length > 1 ? 's' : ''} waiting for you:\n${lines.join('\n')}\nClaim each (bus_send, type claim, ref = its id), restate it, then do it.`,
          }));
        }
      }
    }
    if (tr) st.offset = tr.offset;
    writePrivateJson(stateFile, st);
  } catch (e) {
    if (env.MEMEV_DEBUG) process.stderr.write(`[memev hook ${event}] ${e.message}\n`);
    if (event === 'session-start') emit(format, 'SessionStart', `${PROTOCOL}\n\n[Memev is not reachable right now (${e.message}); run \`memev doctor\`.]`);
  }
  return 0;
}
