// SPDX-License-Identifier: Apache-2.0
// The benchmark vault: synthetic memories, past session journals, project checkpoints, a north star and
// a contract draft, written straight to disk in the formats Memev itself writes. Writing the files (rather
// than calling remember) gives every code version byte-identical notes to search. Seeded: the same level
// always produces the same files.
import fs from 'node:fs';
import path from 'node:path';

export const LEVELS = { small: { memories: 1000, sessions: 60 }, large: { memories: 5000, sessions: 60 } };

// mulberry32
function prng(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), pick: (xs) => xs[Math.floor(next() * xs.length)] };
}

const P = ['billing', 'search', 'mobile-app', 'infra', 'docs', 'analytics', 'auth', 'notifications', 'checkout', 'data-pipeline'];
const TECH = ['Postgres 16', 'Redis 7', 'Kafka', 'Terraform', 'Kubernetes', 'GitHub Actions', 'Stripe', 'Sentry', 'Datadog', 'Next.js 15', 'FastAPI', 'Celery', 'S3', 'CloudFront', 'OpenSearch', 'Prisma', 'Playwright', 'Vitest', 'Docker Compose', 'Cloudflare Workers', 'gRPC', 'Protobuf', 'Grafana', 'PagerDuty', 'Okta', 'Segment', 'dbt', 'Airflow', 'Snowflake'];
const THING = ['the job queue', 'session storage', 'invoice export', 'the search index', 'webhook delivery', 'feature flags', 'rate limiting', 'the nightly backfill', 'image uploads', 'email templates', 'audit logging', 'the admin dashboard', 'schema migrations', 'the staging environment', 'release tagging', 'background retries', 'CSV imports', 'the mobile push gateway', 'tenant isolation', 'the cache layer'];
const PROB = ['times out under load', 'silently drops events', 'returns stale data', 'fails on the first deploy after a migration', 'leaks connections', 'double-charges on retry', 'breaks when the locale is not en-US', 'corrupts the lockfile', 'runs out of memory on large payloads', 'is flaky on CI but not locally', 'rejects tokens older than 5 minutes', 'returns 502 behind the load balancer', 'skips rows with null created_at', 'ignores the timezone setting'];
const FIX = ['set the pool size to 20 and add a 30s idle timeout', 'pin the version and clear the build cache', 'wrap it in an idempotency key', 'run the migration with --lock-timeout 5s', 'move the call out of the request path into a worker', 'add an index on (tenant_id, created_at)', 'use UTC everywhere and convert at the edge', 'raise the memory limit to 2Gi and stream the response', 'retry with jittered backoff capped at 60s', 'validate the payload before enqueueing', 'restart the worker after config changes', 'disable the proxy buffering for that route'];
const REASON = ['an outage on {d} showed the old way loses data', 'it halves the p95 latency in our benchmark', 'legal asked for a 7 year audit trail', 'the team already runs it in production', 'support kept getting the same ticket', 'it keeps the bill under the plan limit', 'the vendor deprecates the old API in {y}', 'two engineers hit this independently', 'it is the only option that works offline', 'it removes a manual step from every release'];
const PEOPLE = ['Maya Chen', 'Tomas Ruiz', 'Priya Nair', 'Jonas Berg', 'Aisha Okafor', 'Liam Walsh', 'Sofia Rossi', 'Kenji Sato', 'Hannah Weiss', 'Diego Alvarez'];
const ROLE = ['owns the {p} on-call rotation', 'approves every change to {t}', 'prefers async updates over calls', 'is the contact at the vendor for {t}', 'reviews all PRs touching {p}', 'is out every Friday', 'wants the weekly report as a short bullet list', 'signs off on pricing changes'];
const PREF = ['Keep answers short and show the diff, not the whole file.', 'Use pnpm, not npm, in every repo.', 'Write tests first for bug fixes.', 'Never auto-commit; ask before pushing.', 'Prefer plain SQL over an ORM for reports.', 'Use British English in user-facing copy.', 'Name branches feat/<ticket>-<slug>.', 'Commit messages in the imperative, under 72 characters.', 'Do not add new dependencies without asking.', 'Explain trade-offs before choosing a library.'];
const KIND_WEIGHTS = [['decision', 28], ['gotcha', 26], ['fact', 22], ['pattern', 8], ['person', 6], ['preference', 6], ['win', 4]];
const KINDS = { decision: 'decisions', gotcha: 'gotchas', fact: 'facts', pattern: 'patterns', win: 'wins', person: 'people', note: 'notes', preference: 'preferences' };
// words for journal turns and checkpoints: ordinary engineering vocabulary, so coding prompts overlap with old sessions
const W = ('deploy pipeline cache layer database migration login error retry queue worker invoice report export schema index token config docker build test flaky timeout '
  + 'endpoint handler service client server metric alert latency memory disk backup restore branch merge review release feature bug fix refactor stripe webhook tenant '
  + 'postgres redis kafka terraform kubernetes sentry grafana playwright lockfile locale timezone pagination serializer idempotency benchmark rollback canary').split(' ');

const pad = (n) => String(n).padStart(2, '0');
// minute stamps in Memev's heading format, counting from a start time
const stampAt = (startIso, minutes) => new Date(Date.parse(startIso) + minutes * 60000).toISOString().slice(0, 16).replace('T', ' ') + 'Z';

function memory(r) {
  let x = r.next() * 100, k = 'win';
  for (const [kind, w] of KIND_WEIGHTS) { if (x < w) { k = kind; break; } x -= w; }
  const p = r.pick(P), t = r.pick(TECH), th = r.pick(THING), n = r.int(2, 9999), tag = `${p.slice(0, 3).toUpperCase()}-${n}`;
  const d = () => `2026-${pad(r.int(1, 10))}-${pad(r.int(1, 28))}`;
  let text, why = null;
  if (k === 'decision') { text = `In ${p} we use ${t} for ${th}; ticket ${tag} records the trade-offs.`; why = r.pick(REASON).replace('{d}', d()).replace('{y}', String(r.int(2026, 2028))); }
  else if (k === 'gotcha') { text = `${t} ${r.pick(PROB)} in ${p} (${th}); fix: ${r.pick(FIX)}. Seen in ${tag}.`; why = r.pick(REASON).replace('{d}', d()).replace('{y}', '2027'); }
  else if (k === 'fact') text = `The ${th} in ${p} runs on ${t} version ${r.int(1, 15)}.${r.int(0, 30)}; the owner is ${r.pick(PEOPLE)} and the runbook is wiki page ${n}.`;
  else if (k === 'pattern') text = `For ${th} in ${p}, always ${r.pick(FIX)} before touching ${t}; this pattern worked in ${tag}.`;
  else if (k === 'person') text = `${r.pick(PEOPLE)} ${r.pick(ROLE).replace('{p}', p).replace('{t}', t)} (as of ${d()}, ${p}).`;
  else if (k === 'preference') { text = `${r.pick(PREF)} (applies to ${p}, set ${d()}.)`; why = r.pick(['the team style guide says so', 'review comments kept asking for it', null]); }
  else text = `Shipped ${th} on ${t} for ${p}: p95 went from ${r.int(300, 900)}ms to ${r.int(60, 250)}ms (${tag}).`;
  return { kind: k, text, why, project: p };
}

const entry = (heading, m) => `\n### ${heading}\n${m.text}\n${m.why ? `Why: ${m.why}\n` : ''}${m.project ? `Project: ${m.project}\n` : ''}`;
const kindHead = (dir, month) => `# ${dir[0].toUpperCase()}${dir.slice(1)} ${month}\n`;

/** Write the benchmark notes into an initialised vault. Returns the paths written. */
export function seedVault(root, level, queries) {
  const L = LEVELS[level]; if (!L) throw new Error(`unknown level ${level}`);
  const r = prng(1234);
  const files = new Map(); // path -> text
  const add = (p, text, head = '') => files.set(p, (files.get(p) ?? head) + text);
  // the memories, one minute apart from 1 October, one file per kind for the month (what remember writes)
  for (let i = 0; i < L.memories; i++) {
    const m = memory(r); const dir = KINDS[m.kind];
    add(`memory/${dir}/2026-10.md`, entry(`${stampAt('2026-10-01T00:00:00Z', i)} · claude-code`, m), kindHead(dir, '2026-10'));
  }
  // the labelled answers: each sits at the item its on-topic prompt names
  for (const n of queries.needles) {
    const [p, heading] = n.item.split('#'); const dir = p.split('/')[1];
    add(p, entry(heading, n), kindHead(dir, p.slice(-10, -3)));
  }
  // past sessions: prompts and replies, as the hooks journal them
  const jr = prng(99);
  const words = (n) => Array.from({ length: n }, () => jr.pick(W)).join(' ');
  const sentence = (n) => { const s = words(n); return `${s[0].toUpperCase()}${s.slice(1)}.`; };
  const PJ = ['billing', 'search', 'mobile-app', 'infra', 'docs', 'analytics'];
  for (let s = 0; s < L.sessions; s++) {
    const pr = PJ[s % PJ.length], sid = `hist${String(s).padStart(3, '0')}`, start = `2026-10-${pad(1 + (s % 26))}T09:00:00Z`;
    const p = `work/sessions/${start.slice(0, 10)}-claude-code-${sid}.md`;
    let t = 0;
    for (let turn = jr.int(8, 16); turn > 0; turn--) {
      add(p, `\n#### ${stampAt(start, t++)} · user\n${sentence(jr.int(12, 45))}\n`, `# Session ${sid} (claude-code)\n\nProject: ${pr}\n`);
      add(p, `\n#### ${stampAt(start, t++)} · assistant\n${Array.from({ length: jr.int(6, 16) }, () => sentence(jr.int(8, 22))).join(' ').slice(0, 2000)}\n`);
    }
  }
  // project checkpoints
  for (const [i, pr] of PJ.entries()) {
    const L2 = [`\n### ${stampAt('2026-10-26T17:00:00Z', i)} · checkpoint · claude-code`, `Task: ${pr}: ${sentence(6)}`];
    for (let d = 0; d < 4; d++) L2.push(`- [x] ${sentence(5)}`);
    L2.push(`Doing: ${sentence(8)}`);
    for (let x = 0; x < 3; x++) L2.push(`- [ ] ${sentence(5)}`);
    L2.push(`Files: ${Array.from({ length: 5 }, () => `${pr}/${jr.pick(W)}.py`).join(', ')}`, 'Source: agent');
    add(`work/active/${pr}.md`, `${L2.join('\n')}\n`, `# ${pr}\n\nProject: ${pr}\nProgress checkpoints, newest last. Memev reads the latest at every session start.\n`);
  }
  files.set('memory/north-star.md', `# North star\n\n${('I am a backend lead at a 12-person B2B SaaS company. I am building the billing and invoicing platform (Postgres, FastAPI, Stripe) and the data pipeline behind analytics. '
    + 'How I like to work: short answers, show the diff and not the whole file, ask before adding dependencies, tests first for bug fixes, never auto-commit. '
    + 'Current goals: cut invoice export latency below 2 seconds, finish the tenant isolation migration by end of Q4, and move the staging environment to Kubernetes.')}\n`);
  // a contract draft left open, as memev_contract_from_request writes one
  files.set('contracts/drafts/c-invoice-csv-export.json', `${JSON.stringify({ id: 'c-invoice-csv-export', title: 'Invoice CSV export', project: 'billing', workdir: '/srv/billing', created: '2026-10-25T10:00:00.000Z', state: 'draft',
    request: 'build a CSV export for invoices', tasks: [{ id: 'T1', title: 'Export script exists', criteria: [{ statement: 'the export script exists', verifier: { type: 'file_exists', path: 'scripts/export_invoices.py' } }] },
      { id: 'T2', title: 'Tests exist and pass', criteria: [{ statement: 'the export tests pass', verifier: { type: 'command', cmd: 'pytest tests/test_export.py' } }] }] }, null, 2)}\n`);
  for (const [p, text] of files) { const f = path.join(root, ...p.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
  return [...files.keys()].sort();
}
