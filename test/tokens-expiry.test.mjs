// Connector credentials do not silently expire: they are long-lived and revocable, and a credential
// that will expire within 14 days warns in doctor, memev status and the operator's resume card.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { newVault, cleanup, tmpdir, OWNER } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
import { TokenStore, tokensPath, EXPIRY_WARNING_DAYS, expiryWarningLine } from '../src/engine/tokens.mjs';
import { clientToken, tokenExpiryWarnings } from '../src/cli/common.mjs';
import { fileChecks } from '../src/cli/doctor.mjs';
import { renderCard } from '../src/engine/card.mjs';

after(cleanup);

const DAY = 86400e3;

test('MEM-056 AC01: a connector token within 14 days of expiry produces a warning in doctor, status and the operator card', () => {
  assert.equal(EXPIRY_WARNING_DAYS, 14);
  const { root, v } = newVault();
  const env = { MEMEV_CONFIG_DIR: tmpdir('conf-') };
  const ts = new TokenStore(tokensPath(root));
  const t = ts.issue({ agent: 'cloud-app', remote: true, ttlDays: 10 });
  const line = expiryWarningLine(ts.list().find((x) => x.id === t.id));
  assert.match(line, /cloud-app connector credential expires in 10 days/);

  // doctor: the check warns, with the warning on its one line
  const c = fileChecks({ root, env, vault: v }).find((x) => x.id === 'token-expiry');
  assert.equal(c.status, 'warn', JSON.stringify(c));
  assert.equal(c.detail.split('expires in 10 days').length - 1, 1, c.detail);

  // memev status: the same line, one per credential near expiry
  assert.match(tokenExpiryWarnings(root).join('\n'), /cloud-app connector credential expires in 10 days/);

  // the operator's resume card says it up front
  const card = renderCard(v.sessionStart(OWNER, { task: 'check the connector' }), { root });
  assert.match(card, /cloud-app connector credential expires in 10 days/);

  // outside the window, or revoked, nothing warns
  const far = ts.issue({ agent: 'other-app', remote: true, ttlDays: 30 });
  assert.doesNotMatch(tokenExpiryWarnings(root).join('\n'), /other-app/);
  ts.revoke(t.id);
  assert.equal(fileChecks({ root, env, vault: v }).find((x) => x.id === 'token-expiry').status, 'ok');
  assert.doesNotMatch(renderCard(v.sessionStart(OWNER, { task: 'check the connector' }), { root }), /cloud-app/);
  ts.revoke(far.id);

  // end to end, through the commands themselves
  const sb = sandbox();
  try {
    assert.equal(sb.run(['init', '--port', String(sb.port), '--local-only', '--no-connect']).code, 0);
    assert.equal(sb.run(['token', 'issue', 'cloud-app', '--ttl', '10', '--remote']).code, 0);
    const d = sb.run(['doctor']);
    assert.equal(d.code, 0, d.err);
    assert.match(d.out, /cloud-app connector credential expires in 10 days/, d.out);
    const s = sb.run(['status']);
    assert.equal(s.code, 0, s.err);
    assert.match(s.out, /cloud-app connector credential expires in 10 days/, s.out);
    const k = sb.run(['card']);
    assert.equal(k.code, 0, k.err);
    assert.match(k.out, /cloud-app connector credential expires in 10 days/, k.out);
  } finally { sb.stop(); }
});

test('MEM-056 AC02: a revoked connector token is refused; a non-revoked connector token keeps working past 90 days (clock injected)', () => {
  // the connector credential a cloud app is handed is long-lived, not the old 90 days
  const { root } = newVault();
  const token = clientToken(root, 'cloud-app', { remote: true });
  const rec = new TokenStore(tokensPath(root)).list().find((t) => t.agent === 'cloud-app' && t.remote);
  assert.ok(rec && Date.parse(rec.expires) - Date.now() > 90 * DAY, `connector credential outlives 90 days (expires ${rec?.expires})`);

  // with an injected clock: still valid 91 days later, and refused at once once revoked
  let nowMs = Date.now();
  const ts = new TokenStore(path.join(tmpdir(), 'tokens.json'), { clock: () => nowMs });
  const t = ts.issue({ agent: 'cloud-app', remote: true, ttlDays: 365 });
  nowMs += 91 * DAY;
  assert.ok(ts.verify(t.token), 'non-revoked connector token works past 90 days');
  ts.revoke(t.id);
  assert.equal(ts.verify(t.token), null, 'revoked connector token is refused');
});
