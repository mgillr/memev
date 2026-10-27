// SPDX-License-Identifier: Apache-2.0
// --check: the metrics of a run against bench/targets.json and bench/baseline.json. The guard (recall quality not
// below the baseline, off-topic injection not above it, and with --latency-vs the recall p95) is part of every
// check; a group adds its token targets, and --only narrows them to one name in the group.
const get = (o, k) => k.split('.').reduce((x, p) => (x == null ? x : x[p]), o);
const fmt = (v) => (typeof v === 'number' ? String(v) : JSON.stringify(v));

export function check(m, { baseline, targets, group = 'all', only = null }) {
  const lines = []; let fails = 0;
  const say = (ok, text) => { lines.push(`${ok ? 'PASS' : 'FAIL'} ${text}`); if (!ok) fails++; };
  const base = baseline?.levels?.[m.level];
  // the guard
  if (!base) say(false, `guard: no baseline for level ${m.level} in bench/baseline.json`);
  else {
    for (const g of targets.guard) {
      const v = get(m, g.metric), b = get(base, g.metric);
      if (v == null || b == null) { say(false, `guard ${g.metric}: missing (run ${fmt(v)}, baseline ${fmt(b)})`); continue; }
      const ok = g.rule === 'not_above_baseline' ? v <= b : v >= b;
      say(ok, `guard ${g.metric} = ${fmt(v)} ${ok ? (g.rule === 'not_above_baseline' ? '<=' : '>=') : g.rule === 'not_above_baseline' ? '>' : '<'} baseline ${fmt(b)} at ${baseline.sha.slice(0, 7)} (${g.why})`);
    }
  }
  if (m.latency?.vs) {
    const L = targets.latency, v = m.latency.recall_p95_ms, b = m.latency.vs.recall_p95_ms;
    const limit = Math.max(b * L.ratio, b + L.ms);
    say(v <= limit, `guard latency.recall_p95_ms = ${v} ${v <= limit ? '<=' : '>'} ${Math.round(limit * 1000) / 1000} (${m.latency.vs.sha.slice(0, 7)} ${b} ms in the same run, within ${Math.round((L.ratio - 1) * 100)} percent or ${L.ms} ms)`);
  }
  // the token targets
  if (group !== 'guard') {
    const sel = targets.targets.filter((t) => (group === 'all' || t.group === group) && (!only || t.only === only));
    if (!sel.length) say(false, `no targets for --group ${group}${only ? ` --only ${only}` : ''}`);
    for (const t of sel) {
      const v = get(m, t.metric);
      const limit = t.max_metric ? get(m, t.max_metric) : t.max;
      let ok, rel;
      if (v == null) { ok = false; rel = 'is missing,'; }
      else if (t.equals !== undefined) { ok = v === t.equals; rel = ok ? '==' : '!='; }
      else { ok = v <= limit; rel = ok ? '<=' : '>'; }
      const want = t.equals !== undefined ? fmt(t.equals) : t.max_metric ? `${t.max_metric} (${fmt(limit)})` : fmt(limit);
      say(ok, `${t.group}/${t.only} ${t.metric} = ${fmt(v)} ${rel} ${want} (${t.contract}: ${t.what})`);
    }
  }
  return { ok: fails === 0, fails, lines };
}
