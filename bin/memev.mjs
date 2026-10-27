#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { main } from '../src/cli/main.mjs';
main(process.argv.slice(2)).then((code) => { process.exitCode = code ?? 0; }, (e) => { console.error(`memev: ${e.message}`); if (process.env.MEMEV_DEBUG) console.error(e.stack); process.exitCode = 1; });
