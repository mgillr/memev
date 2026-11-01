// version: 1
// SPDX-License-Identifier: Apache-2.0
// The mutation gate on the command line. All of it lives in src/engine/mutation-gate.mjs; this file only runs it.
// Usage: node scripts/gate/mutate.mjs --base <sha> --test <cmd> [--scope <glob>]... [--json]
import { main } from '../../src/engine/mutation-gate.mjs';

process.exitCode = await main(process.argv.slice(2));
