// SPDX-License-Identifier: Apache-2.0
// Recall tuning from use. Each recall is logged with what it returned; sessions can say whether an
// item helped (memev_feedback). From that the daemon derives, once a day:
//   per-item boosts   items that keep being useful rank higher, items marked unhelpful rank lower
//   min_score         the bar for injecting memory into a prompt rises when injections are mostly
//                     unhelpful and falls back when they help
// The result lives in .memev/tuning.json; it is derived data and can be deleted at any time.
import path from 'node:path';
import { readJson, writeJson, now } from './util.mjs';

export function tuneRecall(vault) {
  const fb = vault.feedback || new Map();
  const boosts = {};
  let helpful = 0, unhelpful = 0;
  for (const [item, f] of fb) {
    helpful += f.up; unhelpful += f.down;
    const uses = vault.graph.usage.get(item)?.count || 0;
    const b = 1 + 0.15 * Math.log1p(f.up) - 0.25 * Math.log1p(f.down) + 0.03 * Math.log1p(uses);
    boosts[item] = Number(Math.max(0.3, Math.min(2, b)).toFixed(3));
  }
  const base = vault.config.recall?.min_score ?? 1;
  const total = helpful + unhelpful;
  const ratio = total ? unhelpful / total : 0;
  const min_score = total < 10 ? base : Number(Math.max(0.5, Math.min(4, base * (ratio > 0.5 ? 1.25 : ratio < 0.2 ? 0.9 : 1))).toFixed(2));
  const out = { at: now(), items: Object.keys(boosts).length, helpful, unhelpful, min_score, boosts };
  writeJson(path.join(vault.state, 'tuning.json'), out, 0o600);
  vault.tuning = out;
  return { items: out.items, helpful, unhelpful, min_score };
}

export const loadTuning = (vault) => readJson(path.join(vault.state, 'tuning.json'), null);
