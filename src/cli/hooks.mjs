// SPDX-License-Identifier: Apache-2.0
// Session hooks. They run inside the AI client before and after turns, so they must be fast and must
// never break the session: every failure is swallowed (fail open) and the hook exits 0.
//   session-start  → the resume card goes into context before the first turn (and after compaction)
//   prompt         → the prompt is recorded; memory relevant to it is injected (recall without asking)
//   pre-compact    → progress is checkpointed from the transcript before the context is cut
//   stop           → the reply is recorded; the todo list becomes a checkpoint when it changed
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { api, clientToken, resolveRoot } from './common.mjs';
import { ensureDaemon } from './daemon.mjs';
import { scanTranscript, todosToCheckpoint } from './transcript.mjs';
import { readJson, writePrivateJson, sha256, slug } from '../engine/util.mjs';
import { PROTOCOL } from '../engine/card.mjs';

function readStdin() { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } }
export function projectOf(cwd) {
  if (!cwd) return null;
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', timeout: 1500 });
  return slug(path.basename(r.status === 0 && r.stdout.trim() ? r.stdout.trim() : cwd));
}

function emit(format, event, context) {
  if (!context) return;
  if (format === 'plain') { process.stdout.write(`${context}\n`); return; }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } }));
}

export async function runHook(event, flags, env = process.env) {
  const format = flags.format || 'claude';
  let input = {}; try { input = JSON.parse(readStdin() || '{}'); } catch {}
  const root = resolveRoot(flags.root, env);
  const client = String(flags.client || 'claude-code');
  const session = String(input.session_id || input.sessionId || input.conversation_id || env.MEMEV_SESSION || 'session').slice(0, 64);
  const project = flags.project || projectOf(input.cwd || input.workspace_roots?.[0] || process.cwd());
  const stateFile = path.join(root, '.memev', 'hooks', `${slug(session, 64)}.json`);
  const st = readJson(stateFile, { offset: 0, todos: null });
  try {
    if (!(await ensureDaemon(root, { quiet: true }))) throw new Error('daemon not reachable');
    const token = clientToken(root, client);
    const call = (route, body) => api(root, `/v1/${route}`, { body: { session, project, ...body }, token, timeoutMs: 4000 }).then((r) => { if (!r.ok) throw new Error(`${route}: ${r.status}`); return r.json; });
    const tr = input.transcript_path ? scanTranscript(input.transcript_path, { fromOffset: st.offset }) : null;
    const saveCheckpoint = async (source) => {
      const cp = todosToCheckpoint(tr?.todos);
      const h = cp ? sha256(JSON.stringify(cp)) : null;
      if (cp && h !== st.todos) { await call('checkpoint', { ...cp, task: st.task || undefined, files: tr.files, source }); st.todos = h; return true; }
      if (source === 'pre-compact') { await call('checkpoint', { task: st.task || undefined, doing: tr?.lastUser ? `answering: ${tr.lastUser.slice(0, 300)}` : null, files: tr?.files || [], source }); return true; }
      return false;
    };
    if (event === 'session-start') {
      const r = await call('session-start', { task: null });
      await call('journal', { role: 'event', text: `session ${input.source || 'start'} (${client}${project ? `, ${project}` : ''})` }).catch(() => {});
      const lead = input.source === 'compact' ? 'The context was just compacted. The card below is the saved state: continue from "In progress" and do not redo anything listed as done.\n\n' : '';
      emit(format, 'SessionStart', `${lead}${r.protocol || PROTOCOL}\n\n${r.text}`);
    } else if (event === 'prompt') {
      const prompt = String(input.prompt || input.user_prompt || '').trim();
      if (prompt) {
        if (!st.task) st.task = prompt.slice(0, 200);
        await call('journal', { role: 'user', text: prompt });
        const r = await call('recall', { query: prompt.slice(0, 1000), limit: 4 });
        emit(format, 'UserPromptSubmit', r.text);
      }
    } else if (event === 'pre-compact') {
      await saveCheckpoint('pre-compact');
      if (tr?.lastAssistant) await call('journal', { role: 'assistant', text: tr.lastAssistant });
    } else if (event === 'stop') {
      if (tr?.lastAssistant) await call('journal', { role: 'assistant', text: tr.lastAssistant });
      await saveCheckpoint('auto');
    }
    if (tr) st.offset = tr.offset;
    writePrivateJson(stateFile, st);
  } catch (e) {
    if (env.MEMEV_DEBUG) process.stderr.write(`[memev hook ${event}] ${e.message}\n`);
    if (event === 'session-start') emit(format, 'SessionStart', `${PROTOCOL}\n\n[Memev is not reachable right now (${e.message}); run \`memev doctor\`.]`);
  }
  return 0;
}
