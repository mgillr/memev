// SPDX-License-Identifier: Apache-2.0
// Tournaments: when there are competing answers (designs, explanations, hypotheses), sessions record
// head-to-head judgements and Elo ratings sort them. Every match is a logged operation, so the
// standings can be replayed and audited. Thresholds: at or above 1050 a contender advances, below
// 950 it should be decomposed or dropped, in between it stays in play.
export const ELO = { start: 1000, k: 32, advance: 1050, decompose: 950 };
export const ROUNDS = ['attack', 'defense', 'synthesis', 'evidence'];

export class Tournament {
  constructor() { this.ratings = new Map(); this.matches = []; }
  static expected(ra, rb) { return 1 / (1 + 10 ** ((rb - ra) / 400)); }
  rating(id) { return this.ratings.get(id)?.rating ?? ELO.start; }
  applyOp(rec) {
    if (rec.type !== 'tournament.match') return;
    const { topic, a, b, winner, round, why } = rec.data;
    const key = (x) => `${topic}::${x}`;
    for (const x of [a, b]) if (!this.ratings.has(key(x))) this.ratings.set(key(x), { topic, name: x, rating: ELO.start, played: 0, won: 0 });
    const A = this.ratings.get(key(a)), B = this.ratings.get(key(b));
    const ea = Tournament.expected(A.rating, B.rating);
    const sa = winner === a ? 1 : winner === b ? 0 : 0.5;
    A.rating += ELO.k * (sa - ea); B.rating += ELO.k * ((1 - sa) - (1 - ea));
    A.played++; B.played++; if (sa === 1) A.won++; else if (sa === 0) B.won++;
    this.matches.push({ seq: rec.seq, ts: rec.ts, topic, a, b, winner: winner || 'draw', round, why: why || null, by: rec.client || rec.agent });
  }
  standings(topic) {
    return [...this.ratings.values()].filter((r) => r.topic === topic).sort((x, y) => y.rating - x.rating).map((r) => ({ name: r.name, rating: Math.round(r.rating), played: r.played, won: r.won, verdict: r.rating >= ELO.advance ? 'advance' : r.rating < ELO.decompose ? 'decompose' : 'in play' }));
  }
  topics() { return [...new Set([...this.ratings.values()].map((r) => r.topic))]; }
  toJSON() { return { ratings: [...this.ratings.entries()], matches: this.matches.slice(-500) }; }
  load(j) { if (!j) return; this.ratings = new Map(j.ratings || []); this.matches = j.matches || []; }
}
