// SPDX-License-Identifier: Apache-2.0
// `memev why`, `memev review` and `memev audit`: the same operations as the memev_why, memev_review
// and memev_audit tools, from a terminal, through the running daemon.
import { healthy, startDaemon } from './daemon.mjs';
import { api, clientToken } from './common.mjs';

export async function command(cmd, pos, flags, { root }) {
  if (!(await healthy(root))) await startDaemon(root, { quiet: true });
  const call = async (name, args) => {
    const r = await api(root, '/mcp', { token: clientToken(root, 'cli'), body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } });
    const res = r.json?.result; if (!res) throw new Error(r.text); if (res.isError) throw new Error(res.content[0].text);
    return res.structuredContent;
  };
  const show = (o) => console.log(JSON.stringify(o, null, 2));
  if (cmd === 'why') {
    if (!pos.length) throw new Error('memev why <query> [--item path#heading] [--project P] [--all-projects]');
    const r = await call('memev_why', { query: pos.join(' '), item: flags.item, project: flags.project, all_projects: !!flags['all-projects'] });
    if (flags.json) return show(r), 0;
    if (!r.found) { console.log(r.reason || 'Recall returns nothing for this query.'); return 0; }
    for (const it of r.items) { console.log(`${it.item}  (score ${it.score}${it.rank ? `, rank ${it.rank}` : ''})`); for (const l of it.why) console.log(`  ${l}`); }
    if (r.provenance) { console.log(`Written ${r.provenance.written_total} time(s), used ${r.provenance.used_total} time(s).`); for (const w of r.provenance.written) console.log(`  ${w.ts} ${w.op} by ${w.client || w.agent}`); }
    return 0;
  }
  if (cmd === 'review') {
    const action = ['keep', 'drop', 'reset', 'list'].includes(pos[0]) ? pos[0] : 'list';
    const items = action === 'list' ? [] : pos.slice(1);
    const r = await call('memev_review', { action, items, days: flags.days ? Number(flags.days) : undefined });
    if (flags.json || action !== 'list') return show(r), 0;
    if (!r.inbox.length) { console.log('The review inbox is empty.'); return 0; }
    for (const x of r.inbox) console.log(`${x.expired ? 'PAST DATE ' : ''}${x.item}${x.review_by ? `  review by ${x.review_by}` : ''}${x.flags.length ? `  [${x.flags.join(', ')}]` : ''}\n  ${x.snippet}`);
    console.log('\nKeep with: memev review keep <item> [--days N]   Drop with: memev review drop <item>');
    return 0;
  }
  if (cmd === 'audit') {
    const r = await call('memev_audit', {});
    if (flags.json) return show(r), 0;
    console.log(`${r.memories} memories; ${r.likely_junk} look like junk (${Math.round(r.junk_share * 100)}%).`);
    const label = { refused_now: 'would be refused today', duplicates: 'duplicates', expired: 'past their review date', uncertain: 'hedged', never_recalled: 'never recalled in 30+ days', unhelpful: 'rated unhelpful' };
    for (const [k, n] of Object.entries(r.counts)) if (n) { console.log(`  ${n} ${label[k]}`); for (const f of r.findings[k].slice(0, 5)) console.log(`    ${f.item}${f.same_as ? ` = ${f.same_as}` : ''}${f.reason ? `: ${f.reason}` : ''}`); }
    console.log(r.next);
    return 0;
  }
  throw new Error(`unknown command ${cmd}`);
}
