// SPDX-License-Identifier: Apache-2.0
// The write gate for memories. It runs on this machine with fixed rules, so no text is sent anywhere
// to decide what is worth keeping, and every decision comes with its reason.
//
//   refused   too short to mean anything, an acknowledgement ("ok, thanks"), or system noise
//             (heartbeats, cron output, empty replies)
//   duplicate the same thing is already in memory (any kind, or the north star)
//   saved with a review date
//             short-lived ("for now", "today", "this session"): it drops out of recall after the
//             date unless someone keeps it (memev review)
//   saved with a flag
//             hedged ("maybe", "I think"): better recorded as a claim with stance speculate;
//             similar to an existing memory: worth a look in the review inbox
import { tokenize } from './index.mjs';

const ACK = /^(ok(ay)?|k|thanks?( you)?|thx|ty|done|got it|yes|yep|no|nope|sure|noted|cool|great|nice|perfect|hi|hello|hey|ack|understood|will do|sounds good)[\s.!,]*$/i;
const NOISE = /\b(heartbeat|no_reply|health ?check (ok|passed)|cron (job )?(ran|output|finished)|boot sequence|ping ok)\b/i;
const TRANSIENT = /\b(right now|for now|today|tonight|this (session|chat|conversation|morning|afternoon|evening)|at the moment|just now|currently (debugging|working on|testing|running|looking at)|temporar(y|ily)|wip)\b/i;
const HEDGE = /\b(maybe|perhaps|probably|possibly|i think|i guess|not sure|might be)\b/i;

export const DEFAULT_GATE = { enabled: true, transient_days: 7, min_words: 3 };

export function jaccard(a, b) { const A = new Set(tokenize(a)), B = new Set(tokenize(b)); if (!A.size || !B.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i); }
const day = (d) => d.toISOString().slice(0, 10);
export const addDays = (n, from = new Date()) => day(new Date(from.getTime() + n * 86400000));

/** What the gate says about one memory. `similar` is [{ path, heading, snippet }] from the index. */
export function assess(text, { similar = [], gate = DEFAULT_GATE, review_by = null, now = new Date() } = {}) {
  const t = String(text || '').trim();
  const words = tokenize(t);
  const out = { verdict: 'save', reasons: [], flags: [], review_by: null, duplicate_of: null };
  if (ACK.test(t)) return { ...out, verdict: 'refuse', reasons: ['an acknowledgement, not a memory'] };
  if (NOISE.test(t) && words.length < 12) return { ...out, verdict: 'refuse', reasons: ['system noise (heartbeat, cron or health-check output)'] };
  if (words.length < (gate.min_words ?? 3)) return { ...out, verdict: 'refuse', reasons: [`too short to be useful later (${words.length} word${words.length === 1 ? '' : 's'}); say what was decided or learned, and why`] };
  const clean = (s) => String(s || '').replace(/\b(Why|Project|Review-By|Flags): .*$/gm, '').replace(/\s(Why|Project|Review-By|Flags): .*$/, '');
  let best = null;
  for (const h of similar) { const j = jaccard(clean(h.snippet), t); if (!best || j > best.j) best = { ...h, j }; }
  if (best && best.j >= 0.9) return { ...out, verdict: 'duplicate', reasons: [`already in memory (${best.path}${best.heading ? `#${best.heading}` : ''})`], duplicate_of: { path: best.path, heading: best.heading } };
  if (best && best.j >= 0.6) { out.flags.push('similar'); out.reasons.push(`close to ${best.path}${best.heading ? `#${best.heading}` : ''}; if this replaces it, keep this one and drop the old one with memev review`); }
  if (HEDGE.test(t)) { out.flags.push('uncertain'); out.reasons.push('hedged; if it is a guess, memev_claim with stance speculate tracks it better'); }
  if (review_by) out.review_by = /^\d{4}-\d{2}-\d{2}$/.test(String(review_by)) ? String(review_by) : addDays(Number(review_by) || gate.transient_days || 7, now);
  else if (TRANSIENT.test(t)) { out.flags.push('short-lived'); out.review_by = addDays(gate.transient_days || 7, now); out.reasons.push(`reads as short-lived; it leaves recall after ${out.review_by} unless kept`); }
  return out;
}
