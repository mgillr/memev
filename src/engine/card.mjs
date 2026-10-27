// SPDX-License-Identifier: Apache-2.0
// The resume card: the session-start state rendered as plain text, short enough to inject into a
// session's context before its first turn (and again after every compaction).
import { truncate } from './util.mjs';

export const PROTOCOL = `Memev is your persistent memory, shared with every other AI session this person runs.
Follow this loop as part of answering; the user does not have to ask:
1. Start: you have been given a resume card (below or from memev_session_start). Continue from it. Never redo an item listed as done.
2. Before stating a fact the user may have recorded (a decision, a name, a setting, a deadline), call memev_recall. Prefer the vault over guessing.
3. When a decision, gotcha, fact or preference surfaces, call memev_remember at once, in the user's words.
4. After each finished step of a task, call memev_checkpoint with project, task, done, doing and next. This is what survives compaction.
5. For claims with uncertain status use memev_claim (support, oppose or speculate); memev_claims shows what is fact, theory or conjecture.
6. When the user asks you to build something ("I have a project", "build me X", a feature, an app, a tool), before writing code:
   infer the requirements from the conversation and call memev_contract_from_request with them, each with a check that runs on
   this machine (a file that must exist, a command that must exit 0, a pattern a file must contain). Then call memev_contract_sign
   and tell the user in one line what you signed. Do not ask the user to do these steps.
7. While building, run memev_contract_verify after each task: it records a receipt and reports PASS/FAIL per task and what is left.
   Never call the work done until verify says PASS. A signed contract never changes: if the requirements change, memev_contract_amend
   signs a new version that supersedes it. Verification runs locally; it never needs a CI service.
Never store secrets. If Memev is unreachable, say so once and continue.`;

export function renderCard(c, { maxChars = 6000 } = {}) {
  const L = ['[Memev resume card]'];
  if (c.project_state?.checkpoints) {
    const s = c.project_state;
    L.push(`Project ${c.project} (last checkpoint ${s.at}):`);
    if (s.task) L.push(`  Task: ${s.task}`);
    if (s.doing) L.push(`  In progress: ${s.doing}`);
    if (s.next?.length) L.push(`  Next: ${s.next.join('; ')}`);
    if (s.done?.length) L.push(`  Already done (do not redo): ${s.done.join('; ')}`);
    if (s.files) L.push(`  Files touched: ${truncate(s.files, 300)}`);
  } else if (c.active_projects?.length) {
    L.push('Active projects:');
    for (const a of c.active_projects) L.push(`  ${a.project} (${a.at}): ${a.task || ''}${a.doing ? ` | in progress: ${a.doing}` : ''}`);
  }
  for (const k of c.open_contracts || []) {
    L.push(`Active contract ${k.id} v${k.version || 1} "${k.title}"${k.project ? ` (project ${k.project})` : ''}: ${k.passed ?? 0}/${k.total ?? '?'} tasks pass${k.last_verified ? ` at last verify ${k.last_verified}` : ', not verified yet'}.`);
    if (k.remaining?.length) L.push(`  Remaining: ${k.remaining.join('; ')}. Build these, then memev_contract_verify { id: "${k.id}" }.`);
  }
  if (c.last_session?.turns?.length) { L.push(`Last session (${c.last_session.path}):`); for (const t of c.last_session.turns) L.push(`  ${t}`); }
  if (c.recent_decisions?.length) { L.push('Recent decisions:'); for (const d of c.recent_decisions) L.push(`  ${d}`); }
  if (c.relevant?.length) { L.push('Relevant memory:'); for (const h of c.relevant) L.push(`  [${h.path}${h.heading ? `#${h.heading}` : ''}] ${truncate(h.snippet, 260)}${h.claims ? ` {${h.claims.map((x) => `${x.claim}: ${x.status}`).join('; ')}}` : ''}`); }
  if (c.north_star) L.push(`About the user: ${truncate(c.north_star.replace(/\s+/g, ' '), 600)}`);
  return truncate(L.join('\n'), maxChars);
}

export function renderRecall(hits, { maxChars = 1500 } = {}) {
  if (!hits.length) return '';
  const L = ['[Memev recall for this prompt]'];
  for (const h of hits) L.push(`- [${h.path}${h.heading ? `#${h.heading}` : ''}] ${truncate(h.snippet, 300)}`);
  return truncate(L.join('\n'), maxChars);
}
