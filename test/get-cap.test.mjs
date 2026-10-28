// memev_get returns a long note in pages, and joining the pages rebuilds the note.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { newVault, cleanup, OWNER } from './helpers/tmp.mjs';
import { readCapped, sectionOf, GET_PAGE } from '../src/server/mcp.mjs';

after(cleanup);

const line = (n) => `line ${String(n).padStart(4, '0')} ${'x'.repeat(40)}\n`;

function longNote(chars) {
  let body = '';
  let n = 0;
  while (body.length < chars) body += line(n++);
  return body;
}

function pagesOf(body, args = {}) {
  const out = [];
  let offset = 0;
  for (let i = 0; i < 50; i++) {
    const r = readCapped({ path: 'memory/long.md', body }, { ...args, offset });
    out.push(r);
    if (r.data.message || r.data.next == null) break;
    offset = r.data.next;
  }
  return out;
}

test('MEM-107 AC02: A note over 8,000 characters is returned in pages of at most 8,000 characters, each ending at a line boundary, with offset, total and remaining in the result', () => {
  const body = longNote(20000);
  const pages = pagesOf(body);
  assert.ok(pages.length > 1, 'a long note takes more than one page');
  for (const r of pages) {
    assert.ok(r.text.length <= GET_PAGE, 'the text read is at most 8,000 characters');
    assert.ok(r.data.page.length <= GET_PAGE, 'the page is at most 8,000 characters');
    assert.ok(r.data.page.endsWith('\n'), 'the page ends at a line boundary');
    assert.equal(typeof r.data.offset, 'number');
    assert.equal(r.data.total, body.length);
    assert.equal(typeof r.data.remaining, 'number');
    assert.equal(r.data.remaining, body.length - (r.data.offset + r.data.page.length));
  }
});

test('MEM-107 AC03: Concatenating every page of a note gives the note byte for byte; no page repeats or skips text', () => {
  const body = longNote(20000);
  const pages = pagesOf(body);
  assert.equal(pages.map((r) => r.data.page).join(''), body);
  const starts = pages.map((r) => r.data.offset);
  assert.deepEqual(starts, [...new Set(starts)], 'pages do not restart at the same offset');
});

test('MEM-107 AC04: memev_get with a heading returns that section, also capped and continued', () => {
  const section = longNote(12000);
  const body = `# Intro\n\nShort.\n\n## Detail\n${section}\n## After\n\nDone.\n`;
  const first = readCapped({ path: 'memory/long.md', body }, { heading: 'Detail' });
  assert.equal(first.data.message, null);
  assert.ok(first.data.page.startsWith('## Detail\n'), 'the section starts at its heading');
  assert.ok(first.data.page.length < body.length, 'the page is the section, not the whole note');
  assert.ok(first.data.remaining > 0, 'a long section continues');
  assert.ok(first.text.includes('Call memev_get again with offset'), 'the continuation says how to fetch the rest');
  const pages = pagesOf(body, { heading: 'Detail' });
  assert.equal(pages.map((r) => r.data.page).join(''), sectionOf(body, 'Detail'));
  assert.ok(!pages.map((r) => r.data.page).join('').includes('## After'), 'the next section is not included');
});

test('MEM-107 AC05: A note under the cap is returned whole with no continuation text, and an offset past the end gives a clear message, not an error', () => {
  const body = '# Short\n\nHello.\n';
  const whole = readCapped({ path: 'memory/short.md', body }, {});
  assert.equal(whole.data.page, body);
  assert.equal(whole.text, body);
  assert.equal(whole.data.remaining, 0);
  assert.equal(whole.data.next, null);
  assert.equal(whole.text.includes('Call memev_get again'), false);
  const past = readCapped({ path: 'memory/short.md', body }, { offset: body.length + 10 });
  assert.match(past.text, /past the end/);
  assert.equal(past.data.page, '');
  assert.doesNotThrow(() => readCapped({ path: 'memory/short.md', body }, { offset: 999999 }));
});

test('MEM-107 AC06: The continuation text tells the model how to fetch the rest, in one short line', () => {
  const body = longNote(12000);
  const first = readCapped({ path: 'memory/long.md', body }, {});
  const added = first.text.slice(first.data.page.length).replace(/^\n/, '');
  assert.match(added, /^Call memev_get again with offset \d+\. \d+ characters remain\.$/);
  assert.equal(added.includes('\n'), false, 'the continuation is one line');
  assert.ok(added.length < 160, 'the continuation is short');
  const { v } = newVault();
  try {
    v.write(OWNER, { path: 'memory/long.md', body, client: 'test' });
    const via = readCapped(v.get(OWNER, 'memory/long.md'), {});
    assert.match(via.text, /Call memev_get again with offset \d+\. \d+ characters remain\./);
  } finally {
    v.close();
  }
});
