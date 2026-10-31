// SPDX-License-Identifier: Apache-2.0
// node --import test/helpers/load-log.mjs records every module the process resolves, one URL per line, in the file
// that MEMEV_LOAD_LOG names, so a test can say what a command loaded. It registers itself as a resolve hook; the hook
// runs on the loader thread, where it must not register again.
import fs from 'node:fs';
import { register } from 'node:module';
import { isMainThread } from 'node:worker_threads';

const LOG = process.env.MEMEV_LOAD_LOG;
if (isMainThread && LOG) register(import.meta.url, import.meta.url);

export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  if (LOG) fs.appendFileSync(LOG, `${r.url}\n`);
  return r;
}
