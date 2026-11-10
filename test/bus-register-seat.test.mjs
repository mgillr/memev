// SR-1.36 T5: an app connected gets its bus seat at once, so the person can pick it as the lead before its first session,
// and connect --json says which seat each app got and who leads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, initWithRetry } from './helpers/cli.mjs';

const json = (r) => { let j = null; try { j = JSON.parse(r.out); } catch {} assert.ok(j, `one JSON object on stdout:\n${r.out}${r.err}`); return j; };
const seatRow = (r, seat) => { const s = r.seats.find((x) => x.seat === seat); assert.ok(s, `${seat} is on the roster`); return s; };
function setup() {
  const sb = sandbox();
  const init = initWithRetry(sb, ['init', '--port', String(sb.port), '--local-only', '--no-connect']);
  assert.equal(init.code, 0, init.out + init.err);
  fs.mkdirSync(path.join(sb.home, '.claude'), { recursive: true });
  return sb;
}

test('T5-c01: after connect claude-code with no session, bus roster --json lists its seat as registered', () => {
  const sb = setup();
  try {
    assert.equal(sb.run(['connect', 'claude-code']).code, 0);
    const s = seatRow(json(sb.run(['bus', 'roster', '--json'])), 'claude-code@host');
    assert.equal(s.registered, true, 'registered at connect');
    assert.equal(s.state, 'never joined', 'and no session has been seen');
    assert.equal(s.last_seen, null);
  } finally { sb.stop(); }
});

test('T5-c02: bus operator <that seat> succeeds before any session, and the roster then marks it operator', () => {
  const sb = setup();
  try {
    sb.run(['connect', 'claude-code']);
    const o = sb.run(['bus', 'operator', 'claude-code@host']);
    assert.equal(o.code, 0, o.out + o.err);
    const r = json(sb.run(['bus', 'roster', '--json']));
    assert.equal(r.operator, 'claude-code@host');
    const s = seatRow(r, 'claude-code@host');
    assert.equal(s.operator, true); assert.equal(s.registered, true); assert.equal(s.state, 'never joined');
  } finally { sb.stop(); }
});

test('T5-c03: connect --json holds the seat of each connected app, and the operator', () => {
  const sb = setup();
  try {
    fs.mkdirSync(path.join(sb.home, '.cursor'), { recursive: true });
    const r = sb.run(['connect', 'claude-code', 'cursor', '--json']);
    assert.equal(r.code, 0, r.out + r.err);
    const j = json(r);
    assert.deepEqual(j.apps.map((a) => [a.id, a.status, a.seat]), [['claude-code', 'added', 'claude-code@host'], ['cursor', 'added', 'cursor@host']]);
    assert.equal(j.operator, null, 'no lead until the person picks one');
    for (const a of j.apps) { assert.ok(a.files.length > 0); assert.ok(Array.isArray(a.backups)); assert.match(a.restart, /\w/); }
    const lead = json(sb.run(['connect', 'claude-code', '--json'], { extraEnv: { MEMEV_LEAD: 'claude-code' } }));
    assert.equal(lead.operator, 'claude-code@host');
    assert.equal(lead.apps[0].status, 'already');
    assert.deepEqual(lead.seats, ['claude-code@host']);
  } finally { sb.stop(); }
});
