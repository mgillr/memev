#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Recall-quality and token benchmark for Memev. No model calls and no network: everything runs in this process
// against a seeded vault. docs/BENCH.md explains the metrics, the targets and the baseline.
//
//   node scripts/bench/run.mjs [--level small|large] [--group guard|caps|autorecall|protocol|lean|all] [--only NAME]
//        [--check] [--json FILE] [--latency-vs SHA] [--repo DIR] [--repo-sha SHA] [--metrics FILE] [--record]
//
//   --repo-sha SHA   measure the code of that commit instead of this checkout (--repo: the repository, default this one)
//   --latency-vs SHA also time recall on that commit, interleaved with this code in the same process
//   --check          exit 1 when the guard or a target of the group fails (every check includes the guard)
//   --metrics FILE   check the metrics of an earlier --json run instead of measuring
//   --record         store this run as the baseline for its level in bench/baseline.json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { check } from './check.mjs';

const at = new Date().toISOString(); // the real time, before the benchmark clock takes over
const VALUE = new Set(['level', 'group', 'only', 'json', 'latency-vs', 'repo', 'repo-sha', 'metrics']);
const args = {};
for (let a = process.argv.slice(2), i = 0; i < a.length; i++) {
  const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a[i]);
  if (!m) { console.error(`run.mjs: unexpected argument ${a[i]}`); process.exit(2); }
  args[m[1]] = VALUE.has(m[1]) ? (m[2] ?? a[++i]) : true;
}
const level = args.level || 'small', group = args.group || 'all', only = args.only || null;
const { REPO, QUERIES, LEVELS } = await import('./harness.mjs');
const BASELINE = path.join(REPO, 'bench', 'baseline.json'), TARGETS = path.join(REPO, 'bench', 'targets.json');
if (!LEVELS[level]) { console.error(`run.mjs: --level is small or large`); process.exit(2); }
if (!['guard', 'caps', 'autorecall', 'protocol', 'lean', 'all'].includes(group)) { console.error('run.mjs: --group is guard, caps, autorecall, protocol, lean or all'); process.exit(2); }
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

async function measure() {
  const H = await import('./harness.mjs');
  const home = H.prepare();
  const temp = [home];
  try {
    const repo = path.resolve(args.repo || REPO);
    const at_ = (ref) => { const sha = H.revParse(repo, `${ref}^{commit}`); const dir = H.extract(repo, sha); temp.push(dir); return H.loadCode(dir, sha); };
    const code = args['repo-sha'] ? await at_(args['repo-sha']) : await H.loadCode(REPO, (() => { try { return H.revParse(REPO, 'HEAD'); } catch { return 'unknown'; } })()); // a plain export has no git
    const queries = readJson(QUERIES);
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'memev-bench-'));
    temp.push(base);
    const fixed = await H.measureFixed(code, base);
    const b = H.seeded(code, base, level, queries);
    const qa = await H.measureQuality(b, queries);
    const resume = await H.measureResume(b, code);
    const caps = await H.measureCaps(b);
    const notes = b.vault.allNotes().length;
    b.close();
    // latency on fresh copies of the same vault, so both versions search the same notes
    const reps = level === 'large' ? 3 : 5;
    const benches = [H.seeded(code, base, level, queries, 'latency')];
    let vsCode = null;
    if (args['latency-vs']) { vsCode = await at_(args['latency-vs']); benches.push(H.seeded(vsCode, base, level, queries, 'latency-vs')); }
    const lat = await H.measureLatency(benches, queries, reps);
    for (const x of benches) x.close();
    return {
      harness: 1, level, code: { sha: code.sha }, at,
      vault: { ...H.LEVELS[level], notes, needles: queries.needles.length, prompts: { on_topic: queries.on_topic.length, off_topic: queries.off_topic.length, continuation: queries.continuation.length } },
      quality: qa.quality, autorecall: qa.autorecall, fixed, resume, max_result_tokens: caps,
      latency: { ...lat[0], reps, ...(vsCode ? { vs: { sha: vsCode.sha, ...lat[1] } } : {}) },
    };
  } finally { for (const d of temp) fs.rmSync(d, { recursive: true, force: true }); }
}

const m = args.metrics ? readJson(args.metrics) : await measure();
if (args.metrics && m.level !== level && args.level) { console.error(`run.mjs: ${args.metrics} is a ${m.level} run, not ${level}`); process.exit(2); }
if (args.json) fs.writeFileSync(args.json === '-' ? 1 : args.json, `${JSON.stringify(m, null, 1)}\n`);
if (args.record) {
  const b = fs.existsSync(BASELINE) ? readJson(BASELINE) : { about: 'Benchmark baseline: node scripts/bench/run.mjs --repo-sha <sha> --level <level> --record. Recall p95 here is for reference only; the guard compares latency against --latency-vs in the same run.', levels: {} };
  if (b.sha && b.sha !== m.code.sha) { console.error(`run.mjs: bench/baseline.json is for ${b.sha}, this run measured ${m.code.sha}`); process.exit(2); }
  b.sha = m.code.sha; b.levels[m.level] = m;
  fs.writeFileSync(BASELINE, `${JSON.stringify(b, null, 1)}\n`);
}
if (args.json !== '-') {
  const q = m.quality, a = m.autorecall, f = m.fixed, c = m.max_result_tokens;
  console.log(`memev bench · ${m.level} · ${m.code.sha.slice(0, 12)} · ${m.vault.memories} memories, ${m.vault.notes} notes`);
  console.log(`  quality   recall@6 ${q.recall_at_6}  precision@6 ${q.precision_at_6}  recall@4 ${q.recall_at_4}  precision@4 ${q.precision_at_4}`);
  console.log(`  prompts   off-topic injection ${a.offtopic_injection_rate}  mean on ${a.prompt_mean_on}  off ${a.prompt_mean_off}  continuation ${a.prompt_mean_continuation}  repeated ${a.repeated_items}  journal/draft ${a.journal_draft_items}`);
  console.log(`  fixed     default ${f.fixed_overhead_default}  all tools ${f.fixed_overhead_all_tools}  protocol ${f.protocol_tokens} in ${f.protocol_channels} channel(s)  tools/list ${f.tools_list_tokens}`);
  console.log(`  largest   get ${c.get}  recall@1000 ${c.recall_limit_1000}  recall@10 ${c.recall_limit_10}  6-hit ${c.recall_6hit}  bus 200 ${c.bus_unread_200}  list ${c.list_entries} entries`);
  console.log(`  latency   recall p95 ${m.latency.recall_p95_ms} ms${m.latency.vs ? ` (${m.latency.vs.sha.slice(0, 7)}: ${m.latency.vs.recall_p95_ms} ms)` : ''}`);
}
if (args.check) {
  const r = check(m, { baseline: fs.existsSync(BASELINE) ? readJson(BASELINE) : null, targets: readJson(TARGETS), group, only });
  for (const l of r.lines) console.log(l);
  console.log(r.ok ? `check: PASS (${r.lines.length} checks)` : `check: FAIL (${r.fails} of ${r.lines.length} checks failed)`);
  process.exit(r.ok ? 0 : 1);
}
