// SPDX-License-Identifier: Apache-2.0
// Read a session transcript (JSON lines) to recover progress: the latest todo list, files edited,
// the last user request and the last assistant reply. Streams the file; reads only from an offset.
import fs from 'node:fs';
import { readLines } from '../engine/oplog.mjs';

const textOf = (content) => typeof content === 'string' ? content : Array.isArray(content) ? content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n') : '';

export function scanTranscript(file, { fromOffset = 0 } = {}) {
  const res = { todos: null, files: new Set(), lastUser: null, lastAssistant: null, turns: [], offset: fromOffset };
  let size = 0; try { size = fs.statSync(file).size; } catch { return { ...res, files: [] }; }
  if (fromOffset > size) fromOffset = 0;
  let end = fromOffset;
  for (const [line, off] of readLines(file, fromOffset)) {
    end = off + Buffer.byteLength(line) + 1;
    let r; try { r = JSON.parse(line); } catch { continue; }
    const msg = r.message || r; const role = msg.role || r.type;
    const content = msg.content;
    if (role === 'user') {
      const t = textOf(content).trim();
      if (t && !t.startsWith('<') && !(Array.isArray(content) && content.some((c) => c?.type === 'tool_result'))) { res.lastUser = t; res.turns.push({ role: 'user', text: t }); }
    } else if (role === 'assistant') {
      const t = textOf(content).trim(); if (t) { res.lastAssistant = t; res.turns.push({ role: 'assistant', text: t }); }
      if (Array.isArray(content)) for (const c of content) {
        if (c?.type !== 'tool_use') continue;
        if (c.name === 'TodoWrite' && Array.isArray(c.input?.todos)) res.todos = c.input.todos;
        const fp = c.input?.file_path || c.input?.path || c.input?.notebook_path;
        if (fp && /^(Edit|Write|MultiEdit|NotebookEdit|str_replace|create_file)/.test(c.name)) res.files.add(fp);
      }
    }
  }
  res.offset = end;
  return { ...res, files: [...res.files] };
}

/** A checkpoint from a todo list: completed → done, in_progress → doing, pending → next. */
export function todosToCheckpoint(todos) {
  if (!todos?.length) return null;
  const done = todos.filter((t) => t.status === 'completed').map((t) => t.content);
  const doingT = todos.find((t) => t.status === 'in_progress');
  const next = todos.filter((t) => t.status === 'pending').map((t) => t.content);
  return { done, doing: doingT ? doingT.content : null, next };
}
