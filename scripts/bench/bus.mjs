#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SR-1.17's bench: node scripts/bench/bus.mjs --seats 50 --messages 100000 --json prints roster_ms_p95 with the CPU count, the CPU model and the 1-minute load.
import './speed/bus.mjs';
