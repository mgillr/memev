// SPDX-License-Identifier: Apache-2.0
// memev work status <project>: the project status and, for each task, how far its execution history has got, with the four
// kinds kept apart and said in plain words: asked for (requested), taken on (accepted), seen running (observed) and
// confirmed (verified). Only a confirmed task counts as done; a task that was seen running is not done.
import { Vault } from '../engine/vault.mjs';
import { impact } from '../engine/relationships.mjs';

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
  const w = st.work ?? { active: [], blocked: [], approvals: [], stale_evidence: [] };
  return {
    project: st.project, status: st.status, paused: st.paused, done, total, tasks,
    active: w.active.map((a) => ({ ...a, next: nextForActive(a) })),
    blocked: w.blocked.map((b) => ({ ...b, next: nextForBlocked(b) })),
    approvals: w.approvals.map((a) => ({ ...a, next: 'decide the approval; the task waits for it' })),
    stale_evidence: w.stale_evidence.map((e) => ({ ...e, next: 'bind new evidence to the current scope, or replan the task' })),
  };
}

// What the person does next, in words that name a step that exists.
const lapsed = (a) => a.lease_expires != null && a.lease_expires <= Date.now();
const nextForActive = (a) => (lapsed(a) ? 'the lease has lapsed with no heartbeat: reassign the task or cancel it' : 'wait for its report, or cancel it if it is no longer needed');
const nextForBlocked = (b) => (b.reason === 'owner_lost' ? 'its session was lost: reassign the task or cancel it' : 'resolve what blocks it, or cancel it');

/** The text of a status, in the user vocabulary. */
export function renderWorkStatus(w) {
  const lines = [`${w.project}: ${w.status.toLowerCase().replace(/_/g, ' ')}, done ${w.done} of ${w.total}`];
  for (const [id, t] of Object.entries(w.tasks)) {
    const e = t.events;
    lines.push(`  ${id}  ${t.title}  (${t.state.toLowerCase().replace(/_/g, ' ')}; ${STAGE_WORDS[t.stage]})`);
    lines.push(`      ${WORDS.requested} ${e.requested}, ${WORDS.accepted} ${e.accepted}, ${WORDS.observed} ${e.observed}, ${WORDS.verified} ${e.verified}`);
  }
  const iso = (ms) => (ms == null ? 'no expiry recorded' : new Date(ms).toISOString());
  const section = (title, rows, line) => { if (rows?.length) { lines.push('', title); for (const r of rows) lines.push(line(r), `      next: ${r.next}`); } };
  section('Active', w.active, (a) => `  ${a.task}  ${a.title}  held by ${a.owner ?? 'nobody recorded'}, lease until ${iso(a.lease_expires)}`);
  section('Blocked', w.blocked, (b) => `  ${b.task}  ${b.title}  blocked: ${b.reason}`);
  section('Approvals pending', w.approvals, (a) => `  ${a.id}  task ${a.task}${a.what ? `  ${a.what}` : ''}`);
  section('Stale evidence', w.stale_evidence, (e) => `  ${e.id}  task ${e.task}${e.criterion ? `, ${e.criterion}` : ''}`);
  return lines.join('\n');
}

const CLI = { agent: 'cli', scopes: ['read'], paths: ['**'] };
const USAGE = 'usage: memev work status <project> [--json] | memev work pause <project> [--reason <why>] [--json] | memev work resume <project> [--json] | memev work cancel <project> <task> --reason <why> [--json] | memev work impact <id> [--json]';

/** The text of an impact listing: each dependent, whether it is stale, and why it depends. */
export function renderImpact(r) {
  if (!r.dependents.length) return `${r.source}: nothing depends on it`;
  return [`${r.source}: ${r.dependents.length} dependent(s)`, ...r.dependents.map((d) => `  ${d.kind} ${d.id}  ${d.stale ? 'stale' : 'not stale'}  ${d.reason}`)].join('\n');
}

/** The commands: `status`, `pause`, `resume` and `cancel` on a project, and `impact <id>`. Returns the exit code. The first four reach the project through `call(tool, args)`, the daemon's own tools, passed in as a port. The impact listing reads a project store that the
 *  caller passes in, as a port: `openStore(project)` returns the store of that project (or null), or `store` is the store itself.
 *  This module never imports or builds a store. */
export async function runWork(pos, flags = {}, { root, vault = null, store = null, openStore = null, call = null, out = console.log, err = console.error } = {}) {
  if (pos[0] === 'impact' && pos[1]) {
    let s = store;
    if (!s && typeof openStore === 'function') {
      if (!flags.project) { err('memev work impact needs --project <project>'); return 1; }
      s = openStore(String(flags.project));
      if (!s) { err(`no project ${flags.project}`); return 1; }
    }
    if (!s) { err('no project store was given to read the impact from'); return 1; }
    const r = impact(s, pos[1]);
    out(flags.json ? JSON.stringify(r, null, 2) : renderImpact(r));
    return 0;
  }
  if (['pause', 'resume', 'cancel'].includes(pos[0])) return control(pos, flags, { call, vault, root, out, err });
  if (pos[0] === 'status' && !pos[1]) { err(USAGE); return 2; }
  if (pos[0] !== 'status') { err(USAGE); return 1; }
  if (call && !vault) {
    const st = await read(call, pos[1]);
    if (!st) { err(`no project ${pos[1]}`); return 1; }
    const w = workStatus(st);
    out(flags.json ? JSON.stringify(w, null, 2) : renderWorkStatus(w));
    return 0;
  }
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

// The project as the daemon reports it, or null when it has no tasks (the daemon answers an empty draft for a name it does not know).
async function read(call, project) {
  const st = await call('memev_project_status', { project, history: true });
  return st && Object.keys(st.tasks || {}).length ? st : null;
}

// pause, resume and cancel are operator actions: each goes through the daemon's own tools (the port `call`), so the CLI never
// opens a project store beside a running daemon. Exit 0 done, 1 refused or no such project or task, 2 a usage error.
async function control(pos, flags, { call, vault, root, out, err }) {
  const [verb, project, task] = pos;
  const reason = typeof flags.reason === 'string' ? flags.reason.trim() : '';
  if (!project) { err(`usage: memev work ${verb} <project>${verb === 'cancel' ? ' <task> --reason <why>' : ''}`); return 2; }
  if (verb === 'cancel' && !task) { err('usage: memev work cancel <project> <task> --reason <why>'); return 2; }
  if (verb === 'cancel' && !reason) { err('memev work cancel needs --reason <why>: the reason is recorded with who cancelled'); return 2; }
  const port = call ?? ((name, args) => { throw new Error(`no daemon port for ${name}`); });
  const st = await read(port, project);
  if (!st) { err(`no project ${project}`); return 1; }
  const refused = (r) => { err(`${verb} refused: ${r.reason ?? r.code ?? r.error}`); return 1; };
  if (verb === 'pause') {
    const r = await port('memev_project_pause', { project, ...(reason ? { reason } : {}) });
    if (!r?.ok) return refused(r ?? {});
    const tasks = Object.entries(r.cancellations ?? {}).map(([id, cancellation]) => ({ task: id, cancellation }));
    if (flags.json) out(JSON.stringify({ project, paused: true, tasks }, null, 2));
    else out([`${project}: paused, nothing new is dispatched`, ...(tasks.length ? tasks.map((t) => `  ${t.task}  ${t.cancellation}`) : ['  no task is in flight'])].join('\n'));
    return 0;
  }
  if (verb === 'resume') {
    const r = await port('memev_project_resume', { project, ...(reason ? { reason } : {}) });
    if (!r?.ok) return refused(r ?? {});
    out(flags.json ? JSON.stringify({ project, paused: false }, null, 2) : `${project}: resumed, dispatch continues from the last checkpoint`);
    return 0;
  }
  if (!st.tasks[task]) { err(`no task ${task} in ${project}`); return 1; }
  const r = await port('memev_task_cancel', { project, task, reason });
  // an in-flight task answers requested or unsupported: the request is recorded, and the task is cancelled only when its session confirms
  const pending = !r?.ok && ['CANCELLATION_PENDING', 'CANCELLATION_UNSUPPORTED'].includes(r?.code);
  if (!r?.ok && !pending) return refused(r ?? {});
  const state = r.ok ? r.state : st.tasks[task].state;
  const cancellation = r.ok ? 'confirmed' : r.cancellation;
  out(flags.json ? JSON.stringify({ project, task, state, cancellation, reason }, null, 2) : `${task}: ${r.ok ? `cancelled (${reason})` : `cancellation ${cancellation}, the task stays ${state.toLowerCase().replace(/_/g, ' ')} until its session confirms`}`);
  return 0;
}

