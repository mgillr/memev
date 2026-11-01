// SPDX-License-Identifier: Apache-2.0
// memev work status <project>: the project status and, for each task, how far its execution history has got, with the four
// kinds kept apart and said in plain words: asked for (requested), taken on (accepted), seen running (observed) and
// confirmed (verified). Only a confirmed task counts as done; a task that was seen running is not done.
import { Vault } from '../engine/vault.mjs';

const WORDS = { requested: 'asked for', accepted: 'taken on', observed: 'seen running', verified: 'confirmed' };
const STAGE_WORDS = { none: 'not started', ...WORDS };

/** The status of a project as plain data, from the vault's task status read with its history: the derived status, and per task
 *  its state, its furthest stage and the count of each kind. */
export function workStatus(st) {
  const tasks = {};
  for (const [id, t] of Object.entries(st.tasks)) {
    const x = st.execution?.[id] ?? { stage: 'none', requested: 0, accepted: 0, observed: 0, verified: 0 };
    tasks[id] = { title: t.title, state: t.state, stage: x.stage, events: { requested: x.requested, accepted: x.accepted, observed: x.observed, verified: x.verified } };
  }
  const total = Object.keys(tasks).length;
  const done = Object.values(tasks).filter((t) => t.state === 'VERIFIED').length;
  return { project: st.project, status: st.status, paused: st.paused, done, total, tasks };
}

/** The text of a status, in the user vocabulary. */
export function renderWorkStatus(w) {
  const lines = [`${w.project}: ${w.status.toLowerCase().replace(/_/g, ' ')}, done ${w.done} of ${w.total}`];
  for (const [id, t] of Object.entries(w.tasks)) {
    const e = t.events;
    lines.push(`  ${id}  ${t.title}  (${t.state.toLowerCase().replace(/_/g, ' ')}; ${STAGE_WORDS[t.stage]})`);
    lines.push(`      ${WORDS.requested} ${e.requested}, ${WORDS.accepted} ${e.accepted}, ${WORDS.observed} ${e.observed}, ${WORDS.verified} ${e.verified}`);
  }
  return lines.join('\n');
}

const CLI = { agent: 'cli', scopes: ['read'], paths: ['**'] };
const USAGE = 'usage: memev work status <project> [--json]';

/** The command: `status <project>`. Returns the exit code. */
export async function runWork(pos, flags = {}, { root, vault = null, out = console.log, err = console.error } = {}) {
  if (pos[0] !== 'status' || !pos[1]) { err(USAGE); return 1; }
  const own = !vault;
  const v = vault ?? new Vault(root, { git: false }).open();
  try {
    const st = v.tasksStatus(CLI, pos[1], { history: true });
    if (!st) { err(`no project ${pos[1]}`); return 1; }
    const w = workStatus(st);
    out(flags.json ? JSON.stringify(w, null, 2) : renderWorkStatus(w));
    return 0;
  } finally { if (own) v.close(); }
}
