// Nothing is sold before it is built: a feature the status table in docs/tiers/README.md lists as planned may not be
// ticked as included in the pricing table; its cells say "planned". Every feature row of the pricing table is matched
// to the status table here, so a new row cannot slip in unclassified.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const cells = (line) => line.split('|').slice(1, -1).map((c) => c.trim());
// the rows of the pricing table that are limits, not features
const LIMITS = ['Price', 'People', 'Computers using one vault', 'Participating organisations', 'Local AI apps on a computer', 'Cloud AI connectors', 'Trial'];
// each feature row of the pricing table, and the parts of the status table it sells (matched by their start)
const SELLS = {
  'Vault, recall, graph, contracts, doctor, your own tunnel': ['Vault, recall, graph, hooks, contracts, doctor', 'Secure link for cloud AI apps'],
  'Backup to your own GitHub (one writer)': ['Backup to your own private GitHub repository'],
  'One memory for every AI app, and the comms bus between them': ['Vault, recall, graph, hooks, contracts, doctor', 'Comms bus between AI apps'],
  'Several computers on one vault over the secure link, provenance': ['Several computers using one vault through the secure link', 'Per-computer and per-app credentials'],
  'Automatic merge when several computers edit at once (crdt-merge)': ['Concurrent edits on several computers merged'],
  'Hosted end-to-end encrypted sync between computers': ["End-to-end encrypted sync between one person's computers"],
  'Hosted encrypted backup and a stable relay address': ['Hosted encrypted backup', 'Hosted relay with a stable address'],
  'Member keys: one key per person, covering their computers': ['Member keys'],
  "One company vault that all members' work data syncs into, with an admin console that sees and searches it": ["One company vault that all members' work data syncs into", 'Company admin console'],
  'Provider policy: restrict to one provider, egress rules': ['Provider policy'],
  'Company server, departments and roles from an org chart': ['Company server with user accounts', 'Departments, roles and path grants from an org chart'],
  'Sign-in with Google Workspace or Microsoft Entra ID': ['Sign-in with Google Workspace or Microsoft Entra ID'],
  'Rules for what reaches the AI provider, egress log': ['Labels on notes and rules for what reaches the AI provider', 'Egress log of what reached the AI provider'],
  'SCIM, SIEM and audit export, retention, legal hold, high availability': ['Sign-in with Google Workspace or Microsoft Entra ID, SCIM', 'SIEM and audit export', 'High-availability servers'],
  'Multiple sites within one organisation': ['Federation of independently operated site nodes'],
  'Bilateral cross-organisation trust and scoped work exchange': ['Federation of independently operated site nodes'],
  'Cross-organisation programme and portfolio intelligence': ['Federation of independently operated site nodes'],
  'Federated computation across independent participants': ['Federated computation across sites and organisations'],
};

/** Part -> 'built' or 'planned', from the "What is built and what is planned" table. */
function statuses(text) {
  const body = text.slice(text.indexOf('## What is built and what is planned'));
  const out = new Map();
  for (const line of body.split('\n').slice(1)) {
    if (line.startsWith('## ')) break;
    const [part, status] = cells(line);
    if (status === 'built' || status === 'planned') out.set(part, status);
  }
  return out;
}

/** Every way the pricing table sells something that is not built, or lists a feature nobody classified. */
export function problems(pricing, status) {
  const found = [];
  const table = pricing.slice(pricing.indexOf('## Tiers')).split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('|---'));
  const tiers = cells(table[0]).slice(1);
  for (const line of table.slice(1)) {
    const [row, ...values] = cells(line);
    if (LIMITS.includes(row)) continue;
    const parts = SELLS[row];
    if (!parts) { found.push(`unclassified row: ${row}`); continue; }
    const states = parts.map((p) => [...status].find(([part]) => part.startsWith(p))?.[1]);
    if (states.includes(undefined)) { found.push(`${row}: a part it sells is missing from the status table`); continue; }
    if (!states.includes('planned')) continue;
    values.forEach((v, i) => {
      if (!v || /\bplanned\b/.test(v)) return;
      // These cells explicitly exclude a shared company vault in the Federated tier.
      if (tiers[i].includes('Federated') && /^(?:no:|deployment-specific; no shared global vault)/i.test(v)) return;
      found.push(`${row} / ${tiers[i]}: "${v}" sells a planned feature`);
    });
  }
  return found;
}

test("MEM-066 AC01: The test fails if any unbuilt feature is listed as included without the word 'planned'", () => {
  const pricing = read('docs/PRICING.md');
  const status = statuses(read('docs/tiers/README.md'));
  assert.ok([...status.values()].includes('planned') && [...status.values()].includes('built'), 'the status table was read');
  assert.deepEqual(problems(pricing, status), []);
  // a tick put back on a planned feature is caught
  const sync = pricing.split('\n').find((l) => l.startsWith('| Hosted end-to-end encrypted sync'));
  assert.ok(sync.includes('planned'));
  const ticked = pricing.replace(sync, sync.replace('planned', '✓'));
  assert.deepEqual(problems(ticked, status), ['Hosted end-to-end encrypted sync between computers / Personal with more computers: "✓" sells a planned feature']);
  // and so is a new feature row that nobody matched to the status table
  const added = pricing.replace(sync, `${sync}\n| Teleporting notes between offices | | ✓ | ✓ | ✓ |`);
  assert.deepEqual(problems(added, status), ['unclassified row: Teleporting notes between offices']);
  // a feature that is still planned in the status table keeps its row honest even if the pricing page is not edited
  const built = new Map(status); built.set("End-to-end encrypted sync between one person's computers", 'built');
  assert.deepEqual(problems(pricing, built), [], 'once sync is built, "planned" cells are allowed to stay until the page is updated');
});

test('the Personal description in the tiers pages matches the pricing table and names the bus', () => {
  const personal = read('docs/tiers/free.md').split('## Personal')[1];
  assert.match(personal, /up to 3 computers/);
  assert.match(personal, /comms bus/);
  assert.match(personal, /Planned, not built, and not part of the price/);
  assert.match(read('docs/PRICING.md'), /Personal with more computers is sold for what exists today/);
});
