// MEM-087: the opt-in, off-by-default "Made with Memev" footer on exported hand-offs and contract
// summaries. Only on artefacts a user exports and shares; never in private notes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, mcpClient } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';

const FOOTER = 'Made with Memev';

// A fresh, initialised vault with its daemon reachable through the real CLI.
function fresh() {
  const sb = sandbox();
  const r = sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']);
  assert.equal(r.code, 0, r.err + r.out);
  return sb;
}
const configPath = (sb) => path.join(sb.root, '.memev', 'config.json');
const footerSetting = (sb) => JSON.parse(fs.readFileSync(configPath(sb), 'utf8')).footer;
function setFooter(sb, on) {
  const c = JSON.parse(fs.readFileSync(configPath(sb), 'utf8'));
  if (on) c.footer = true; else delete c.footer;
  fs.writeFileSync(configPath(sb), JSON.stringify(c, null, 2));
}
// A signed contract, so the summary is a real summary. Returns the contract id.
async function signContract(sb) {
  const work = path.join(sb.home, 'work'); fs.mkdirSync(work, { recursive: true });
  const mcp = mcpClient(sb, 'cursor');
  try {
    await mcp.request('initialize', { protocolVersion: '2025-06-18' });
    const d = await mcp.tool('memev_contract_draft', {
      title: 'Add a health endpoint', project: 'api', workdir: work,
      tasks: [{ id: 'T1', title: 'health endpoint', scope: ['**'], criteria: [{ statement: 'the handler exists', verifier: { type: 'file_exists', path: 'health.js' } }] }],
    });
    assert.ok(!d.isError, JSON.stringify(d));
    const id = d.structuredContent.id;
    const s = await mcp.tool('memev_contract_sign', { id });
    assert.ok(!s.isError, JSON.stringify(s));
    return id;
  } finally { await mcp.close(); }
}
// Every file in the vault that carries the footer text (the .git directory is not vault content).
function filesWithFooter(sb) {
  const found = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { if (fs.readFileSync(p, 'utf8').includes(FOOTER)) found.push(p); } catch {} }
    }
  };
  walk(sb.root);
  return found;
}

test('MEM-087 AC01: exports have no footer by default', () => {
  const sb = fresh();
  try {
    assert.equal(footerSetting(sb), undefined, 'the footer setting is absent by default');
    const card = sb.run(['card']);
    assert.equal(card.code, 0, card.err);
    assert.ok(card.out.length > 0, 'the hand-off renders');
    assert.ok(!card.out.includes(FOOTER), `the exported hand-off has no footer by default:\n${card.out}`);
    const status = sb.run(['contract', 'status']);
    assert.equal(status.code, 0, status.err);
    assert.ok(!status.out.includes(FOOTER), `the contract summary has no footer by default:\n${status.out}`);
  } finally { sb.stop(); cleanup(); }
});

test('MEM-087 AC02: with the setting on, only exported hand-offs and contract summaries get the footer, never notes', async () => {
  const sb = fresh();
  try {
    // A private note that must never carry the footer, and a signed contract for a real summary.
    const rem = sb.run(['remember', 'The deploy window is the first Sunday of the month', '--kind', 'fact']);
    assert.equal(rem.code, 0, rem.err);
    await signContract(sb);

    setFooter(sb, true);
    assert.equal(footerSetting(sb), true);

    // The exported hand-off gets the footer.
    const card = sb.run(['card']);
    assert.equal(card.code, 0, card.err);
    assert.ok(card.out.includes(FOOTER), `the exported hand-off gets the footer when the setting is on:\n${card.out}`);

    // The contract summary gets the footer.
    const status = sb.run(['contract', 'status']);
    assert.equal(status.code, 0, status.err);
    assert.ok(status.out.includes(FOOTER), `the contract summary gets the footer when the setting is on:\n${status.out}`);

    // Notes never get the footer: recalling the note shows it clean...
    const recall = sb.run(['recall', 'deploy window']);
    assert.equal(recall.code, 0, recall.err);
    assert.ok(!recall.out.includes(FOOTER), `a recall of a note must never carry the footer:\n${recall.out}`);
    // ...and no stored file in the vault carries it.
    assert.deepEqual(filesWithFooter(sb), [], `no stored file in the vault carries the footer: ${filesWithFooter(sb).join(', ')}`);
  } finally { sb.stop(); cleanup(); }
});
