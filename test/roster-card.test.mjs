// The share-friendly roster card: the apps and the seat count, with nothing that identifies a person,
// a token, a path or the machine a seat runs on.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox } from './helpers/cli.mjs';
import { cleanup } from './helpers/tmp.mjs';
after(cleanup);

test('MEM-071 AC01: roster --card shows the apps and seat count with no path, token, e-mail or machine name', () => {
  const sb = sandbox();
  try {
    for (const d of ['.claude', '.cursor']) fs.mkdirSync(path.join(sb.home, d), { recursive: true });
    const init = sb.run(['init', '--port', String(sb.port), '--local-only', '--lead', 'claude-code@host']);
    assert.equal(init.code, 0, init.err + init.out);
    const roster = JSON.parse(sb.run(['bus', 'roster', '--json']).out);
    const seats = roster.seats.filter((s) => s.seat);
    const card = sb.run(['bus', 'roster', '--card']);
    assert.equal(card.code, 0, card.err + card.out);
    const out = card.out;
    // the apps and the seat count
    for (const s of seats) assert.ok(out.includes(s.client), `the card names the app ${s.client}`);
    assert.ok(out.includes(`${seats.length} seat`), `the card says ${seats.length} seats`);
    // no machine name: the full seat (app@machine) and the bare device label are both hidden
    for (const s of roster.seats) {
      if (s.seat) assert.ok(!out.includes(s.seat), `the card hides the seat ${s.seat}`);
      if (s.device_label) assert.ok(!out.includes(s.device_label), `the card hides the machine name ${s.device_label}`);
    }
    // no path, no token, no e-mail
    assert.ok(!out.includes(sb.home), 'the card has no home path');
    assert.ok(!out.includes(sb.root), 'the card has no vault path');
    const token = JSON.parse(fs.readFileSync(path.join(sb.root, '.memev', 'clients.json'), 'utf8'))['cli'];
    assert.ok(token && !out.includes(token), 'the card has no client token');
    assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(out), 'the card has no e-mail address');
  } finally { sb.stop(); }
});
