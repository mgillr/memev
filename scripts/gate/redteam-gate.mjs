// SPDX-License-Identifier: Apache-2.0
// gate-version: 1
// The red-team gate on the command line, a thin wrapper over src/engine/redteam-gate.mjs (the same code
// the engine's draft and sign paths run). One line per spec: SIGNABLE, SIGNABLE AT STOP (<n> open items),
// NOT SIGNABLE: <reasons>, or NO RECORD.
// Usage: node scripts/gate/redteam-gate.mjs [spec.json ...]           exit 0 only when every spec is SIGNABLE
//        node scripts/gate/redteam-gate.mjs --report [spec.json ...]  exit 0 unless a record is malformed, a record
//                                                                     claims clean on a changed spec, or a signed
//                                                                     contract has no SIGNABLE record
// With no spec named, every .json file under contracts/seed-readiness/specs/, contracts/quality-loop/specs/ and contracts/scope-one/specs/.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gate } from '../../src/engine/redteam-gate.mjs';

export { evaluate, gate, RULES, REVIEWER_KEYS, STOP_KEYS, STOP_PAYLOAD_TYPE, GRANDFATHERED } from '../../src/engine/redteam-gate.mjs';

export function main(argv, cwd = process.cwd()) {
  const report = argv.includes('--report');
  const unknown = argv.filter((a) => a.startsWith('-') && a !== '--report');
  if (unknown.length) { console.error(`unknown option: ${unknown.join(' ')}`); return 2; }
  const r = gate({ cwd, specs: argv.filter((a) => !a.startsWith('-')), report });
  for (const l of r.lines) console.log(l);
  for (const e of r.errors) console.error(e);
  return r.exit;
}

let direct = false;
try { direct = !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { direct = false; }
if (direct) process.exitCode = main(process.argv.slice(2));
