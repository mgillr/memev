// SPDX-License-Identifier: Apache-2.0
// Writes the committed red-team gate fixtures: base/ (the SIGNABLE base fixture) and cases/<code>/ (one
// tree per reason code in RULES, each refused with that code, plus cases/ok/). Every tree holds a build.sh
// that commits it the way the tests expect. The trees are signed with a throwaway key made here: its public
// half is written to reviewer.pub and its private half is never written anywhere.
// Usage: node test/fixtures/redteam/build-fixtures.mjs [--base-key <reviewer private key PEM file>]
//   --base-key signs base/ with the reviewer's own key (the key REVIEWER_KEYS trusts); without it base/ is
//   signed with the throwaway key. cases/ are always signed with the throwaway key.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateKeyPair } from '../../../vendor/attest/signature.mjs';
import { HERE, scenario, stopDecision, specV2, GIT_ENV } from './lib.mjs';

const THROWAWAY = generateKeyPair();

const MUTATIONS = {
  schema: { record: (r) => { r.schema = 'memev-redteam/0'; } },
  spec_id: { record: (r) => { r.spec_id = 'QL-0.02'; } },
  rounds_contiguous: { record: (r) => { r.rounds[1].round = 3; } },
  last_clean: { record: (r) => { r.rounds[1].verdict = 'findings'; } },
  last_high: { record: (r) => { r.rounds[1].answers[0].severity = 'high'; } },
  hash: { record: (r) => { r.rounds[1].spec_sha256 = '0'.repeat(64); } },
  dispositions_all_rounds: { record: (r) => { delete r.rounds[0].answers[1].disposition; } },
  added_verbatim: { record: (r) => { r.rounds[0].answers[0].criterion.statement += ' (reworded)'; } },
  rejected_reason: { record: (r) => { r.rounds[0].answers[1].reason = ''; } },
  never_weakens: { options: { disk: { ...specV2(), workdir: '/tmp/elsewhere' } } },
  red_green_required: { record: (r) => { r.rounds[1].manifest_kind = 'docs'; } },
  head_stale_src: { options: { steps: "printf 'export const a = 2;\\n' > src/a.mjs\ngit add -A -- src\ngit -c commit.gpgsign=false commit -q -m 'a changes after the review'" } },
  review_sig: { record: (r) => { delete r.rounds[1].sig; }, sign: false },
  // the rounds' signatures and the closing envelope do not cover the stop, so nothing is signed again
  stop_decision: { record: (r, s) => { r.stop = stopDecision(r, s.disk(), THROWAWAY.privateKey); }, sign: false },
};

/** The reviewed commit's tree plus the red-team record directory as it is now: what build.sh rebuilds. */
function exportTree(s, to) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(to, { recursive: true });
  const tar = spawnSync('git', ['archive', '--format=tar', s.reviewed], { cwd: s.dir, env: GIT_ENV, maxBuffer: 64 << 20 });
  if (tar.status !== 0) throw new Error('git archive failed');
  const x = spawnSync('tar', ['-x', '-C', to], { input: tar.stdout });
  if (x.status !== 0) throw new Error('tar failed');
  fs.cpSync(path.join(s.dir, s.redteam), path.join(to, s.redteam), { recursive: true });
}

function main(argv) {
  const k = argv.indexOf('--base-key');
  const basePriv = k >= 0 ? fs.readFileSync(argv[k + 1], 'utf8') : THROWAWAY.privateKey;
  fs.writeFileSync(path.join(HERE, 'reviewer.pub'), THROWAWAY.publicKey);
  const made = [];
  const base = scenario({ priv: basePriv });
  exportTree(base, path.join(HERE, 'base'));
  made.push('base');
  const ok = scenario({ priv: THROWAWAY.privateKey });
  exportTree(ok, path.join(HERE, 'cases', 'ok'));
  made.push('cases/ok');
  for (const [code, m] of Object.entries(MUTATIONS)) {
    const s = scenario({ ...(m.options || {}), priv: THROWAWAY.privateKey });
    if (m.record) s.mutate((r) => m.record(r, s), { sign: m.sign !== false });
    exportTree(s, path.join(HERE, 'cases', code));
    made.push(`cases/${code}`);
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
  for (const s of [base, ok]) fs.rmSync(s.dir, { recursive: true, force: true });
  console.log(`wrote ${made.length} fixture trees under ${path.relative(process.cwd(), HERE) || '.'}: ${made.join(', ')}`);
}

main(process.argv.slice(2));
