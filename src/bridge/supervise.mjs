// SPDX-License-Identifier: Apache-2.0
// The daemon hosts the chat bridges, so they run while Memev runs. Every few seconds it compares
// what the person turned on (the state files the memev chat commands write) with what is running,
// and starts or stops bridges to match: no restart is needed after enable, pair or disable.
import fs from 'node:fs';
import { Bridge } from './core.mjs';
import { CHANNELS, channelDir, readState, noteStatus } from './state.mjs';

const RETRY_MS = 60e3;

/** Whether a channel should run, and if not, why. */
export async function wanted(root, channel) {
  if (!fs.existsSync(channelDir(root, channel))) return { run: false, why: 'off' };
  if (channel === 'whatsapp') {
    const { whatsappEnabled, whatsappLinked } = await import('./whatsapp.mjs');
    const { installedProblem } = await import('./whatsapp-install.mjs');
    if (!whatsappEnabled(root)) return { run: false, why: 'off' };
    const why = installedProblem(root); if (why) return { run: false, why };
    if (!whatsappLinked(root)) return { run: false, why: 'not linked: memev chat whatsapp link' };
    return { run: true };
  }
  if (channel === 'telegram') return readState(root, 'telegram', 'config')?.token ? { run: true } : { run: false, why: 'off' };
  if (channel === 'discord') {
    if (!readState(root, 'discord', 'config')?.token) return { run: false, why: 'off' };
    return readState(root, 'discord', 'paired') ? { run: true } : { run: false, why: 'not paired: memev chat discord pair' };
  }
  if (channel === 'lark') return { run: false, why: readState(root, 'lark', 'config') ? 'the Lark connection is not built yet' : 'off' };
  return { run: false, why: 'unknown channel' };
}

export async function makePlugin(channel, root, { log }) {
  const limit = Number(readState(root, channel, 'enabled')?.limit) || 30;
  if (channel === 'whatsapp') { const { WhatsAppPlugin } = await import('./whatsapp.mjs'); return new WhatsAppPlugin({ root, limit, log }); }
  if (channel === 'discord') { const { DiscordPlugin } = await import('./discord.mjs'); return new DiscordPlugin({ root, limit, log }); }
  if (channel === 'telegram') { const { TelegramPlugin } = await import('./telegram.mjs'); return new TelegramPlugin({ root, limit, log }); }
  throw new Error(`no plugin for ${channel}`);
}

export function supervise(vault, { root, make = makePlugin, intervalMs = 5000, log = (l) => console.error(`[memev] chat ${l}`) } = {}) {
  const running = new Map(); const failedAt = new Map(); let stopped = false; let chain = Promise.resolve();
  const once = async () => {
    if (stopped) return;
    {
      for (const ch of CHANNELS) {
        const w = await wanted(root, ch);
        const cur = running.get(ch);
        if (w.run && !cur) {
          if (Date.now() - (failedAt.get(ch) || 0) < RETRY_MS) continue;
          try {
            const plugin = await make(ch, root, { log: (l) => log(`${ch}: ${l}`) });
            const bridge = new Bridge({ bus: vault.bus, plugin, root, log: (l) => log(`${ch}: ${l}`) });
            await bridge.start(); running.set(ch, bridge); failedAt.delete(ch);
            log(`${ch}: bridge running as ${bridge.seat}`);
          } catch (e) { failedAt.set(ch, Date.now()); log(`${ch}: ${e.message}`); noteStatus(root, ch, { running: false, error: e.message }); }
        } else if (!w.run && cur) {
          running.delete(ch);
          await cur.stop({ logout: w.why === 'off' }); // turned off: a linked WhatsApp device is also logged out on the phone
          log(`${ch}: bridge stopped (${w.why})`);
        }
      }
    }
  };
  // one look at a time, in order: a look asked for while one runs waits for it
  const tick = () => (chain = chain.then(once, once));
  const timer = setInterval(() => { tick().catch((e) => log(e.message)); }, intervalMs); timer.unref?.();
  tick().catch((e) => log(e.message));
  return {
    running,
    tick,
    reload() { tick().catch(() => {}); },
    async stop() { stopped = true; clearInterval(timer); for (const b of running.values()) await b.stop().catch(() => {}); running.clear(); },
  };
}
