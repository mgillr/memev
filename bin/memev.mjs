#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// The memev command: a hook goes straight to runHook in cli/hooks.mjs, every other command to main in cli/main.mjs.
// A hook runs inside the AI app before and after every turn, so it loads only the hook code, not the whole CLI, with
// the same flag parsing and the same runHook call that main.mjs makes for 'memev hook', and reaches the daemon with
// node:http instead of fetch (useDirectLoopback in cli/common.mjs).
const argv = process.argv.slice(2);
const start = argv[0] === 'hook'
  ? Promise.all([import('../src/cli/common.mjs'), import('../src/cli/hooks.mjs')]).then(([c, h]) => { c.useDirectLoopback(); const { flags, pos } = c.parseArgs(argv.slice(1), c.BOOLEAN_FLAGS); return h.runHook(pos[0], flags, process.env); })
  : import('../src/cli/main.mjs').then((m) => m.main(argv));
start.then((code) => { process.exitCode = code ?? 0; }, (e) => { console.error(`memev: ${e.message}`); if (process.env.MEMEV_DEBUG) console.error(e.stack); process.exitCode = 1; });
