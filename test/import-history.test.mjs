// SPDX-License-Identifier: Apache-2.0
// The chat history import: each export and session format read from its documented place, one note per conversation,
// a big export streamed, an import run twice, secrets skipped, the scan as JSON, undo, and the setup offer.
// Every fixture is synthetic, in the documented shape (test/fixtures/history), inside a temporary home.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { PassThrough, Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { tmpdir, cleanup, OWNER, newVault } from './helpers/tmp.mjs';
import { sandbox } from './helpers/cli.mjs';
import { scanHistory, walkHistory, exportConversations, SESSION_SOURCES, HISTORY_DIR, geminiReplay } from '../src/engine/importers/history.mjs';
import { runFullImport, listImports, undoImport, scanSources, chooseSources, sourceList } from '../src/engine/importers/core.mjs';
import { jsonArrayItems } from '../src/engine/json-stream.mjs';
import { listZip, entryStream } from '../src/engine/zip.mjs';

after(() => cleanup());

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'history');
const fixture = (name) => fs.readFileSync(path.join(FIX, name));
// A fake credential for the secret checks, built from parts so that secret scanners do not flag this file.
const FAKE_KEY = ['sk', 'live', 'abcdefghijklmnop1234567890'].join('-');

// a stored (uncompressed) zip, as the export services write small files; enough for the reader under test
function makeZip(entries) {
  const parts = []; const cd = []; let offset = 0;
  for (const { name, data } of entries) {
    const n = Buffer.from(name); const d = Buffer.isBuffer(data) ? data : Buffer.from(data); const crc = zlib.crc32(d);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(d.length, 18); lh.writeUInt32LE(d.length, 22); lh.writeUInt16LE(n.length, 26);
    parts.push(lh, n, d);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc, 16); c.writeUInt32LE(d.length, 20); c.writeUInt32LE(d.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    cd.push(c, n);
    offset += 30 + n.length + d.length;
  }
  const cdBuf = Buffer.concat(cd); const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cdBuf.length, 12); e.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, e]);
}

const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); return file; };

// a home with every source in its documented place
function makeHome() {
  const home = tmpdir('hist-home-');
  const env = { HOME: home };
  put(path.join(home, '.claude', 'projects', '-home-user-zephyr', '5e550000-0000-4000-8000-000000000001.jsonl'), fixture('claude-code-session.jsonl'));
  put(path.join(home, '.claude', 'projects', '-home-user-zephyr', '5e550000-0000-4000-8000-000000000001', 'subagents', 'agent-1.jsonl'), fixture('claude-code-session.jsonl'));
  put(path.join(home, '.claude', 'projects', '-home-user-zephyr', '5e550000-0000-4000-8000-000000000001.orphaned-1-x.jsonl'), fixture('claude-code-session.jsonl'));
  put(path.join(home, '.codex', 'sessions', '2026', '11', '02', 'rollout-2026-11-02T08-00-00-c0dec0de-0000-4000-8000-000000000001.jsonl'), fixture('codex-rollout.jsonl'));
  put(path.join(home, '.gemini', 'tmp', 'zephyr', 'chats', 'session-2026-11-03T07-00-9e000000.jsonl'), fixture('gemini-session.jsonl'));
  put(path.join(home, '.gemini', 'tmp', 'zephyr', '.project_root'), '/home/user/zephyr\n');
  put(path.join(home, '.gemini', 'tmp', '0f0e0d0c0b0a09080706050403020100', 'chats', 'session-2025-09-01T07-00-9e000000.json'), fixture('gemini-session-old.json'));
  put(path.join(home, '.qwen', 'projects', '-home-user-zephyr', 'chats', '0123456789abcdef0123456789abcdef.jsonl'), fixture('qwen-session.jsonl'));
  const janRoot = SESSION_SOURCES.find((s) => s.id === 'jan').root(env);
  put(path.join(janRoot, '8f2c9922-db49-4d1e-8620-279c05baf2d0', 'thread.json'), fixture('jan-thread.json'));
  put(path.join(janRoot, '8f2c9922-db49-4d1e-8620-279c05baf2d0', 'messages.jsonl'), fixture('jan-messages.jsonl'));
  put(path.join(home, '.continue', 'sessions', 'c0ffee00-0000-4000-8000-000000000001.json'), fixture('continue-session.json'));
  put(path.join(home, '.continue', 'sessions', 'sessions.json'), fixture('continue-sessions-index.json'));
  put(path.join(home, '.cline', 'data', 'tasks', '1762300000000', 'api_conversation_history.json'), fixture('cline-api_conversation_history.json'));
  put(path.join(home, 'Downloads', 'chatgpt-export.zip'), makeZip([{ name: 'conversations.json', data: fixture('chatgpt-conversations.json') }, { name: 'user.json', data: '{"id":"user-1"}' }, { name: 'chat.html', data: '<html></html>' }]));
  put(path.join(home, 'Downloads', 'data-claude.zip'), makeZip([{ name: 'conversations.json', data: fixture('claude-conversations.json') }, { name: 'projects.json', data: fixture('claude-projects.json') }, { name: 'users.json', data: '[]' }]));
  put(path.join(home, 'Downloads', 'holiday-photos.zip'), makeZip([{ name: 'a.txt', data: 'not an export' }]));
  return { home, env };
}

const ALL = ['claude-code', 'codex', 'gemini-cli', 'qwen-code', 'jan', 'continue', 'cline'];
const notesOf = (v) => v.allNotes().filter((p) => p.startsWith(HISTORY_DIR + '/'));
const bodyOf = (v, appDir) => notesOf(v).filter((p) => p.startsWith(`${HISTORY_DIR}/${appDir}/`)).map((p) => v.get(OWNER, p).body).join('\n---\n');

test('history scan: finds every documented source in a fake home, with counts, sizes and dates; scan and import leave every source file as it was', async () => {
  const { home, env } = makeHome();
  const snapshot = () => { const m = new Map(); const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else m.set(p, `${fs.statSync(p).mtimeMs}:${fs.readFileSync(p).toString('base64')}`); } }; walk(home); return m; };
  const before = snapshot();
  const sources = await scanHistory({ env });
  const ids = sources.map((s) => s.id);
  for (const id of ALL) assert.ok(ids.includes(id), `${id} found: ${ids.join(', ')}`);
  const cc = sources.find((s) => s.id === 'claude-code');
  assert.equal(cc.count, 1, 'one session: a subagent transcript and a set-aside copy are not sessions');
  assert.ok(cc.bytes > 0 && cc.first && cc.last, 'size and dates');
  assert.deepEqual(cc.projects.map((p) => p.id), ['claude-code/-home-user-zephyr'], 'grouped by project');
  assert.equal(sources.find((s) => s.id === 'gemini-cli').count, 2, 'a .jsonl session and an older .json one');
  const exportsFound = sources.filter((s) => s.kind === 'export');
  assert.deepEqual(exportsFound.map((s) => [path.basename(s.path), s.app, s.count]).sort(), [['chatgpt-export.zip', 'ChatGPT export', 2], ['data-claude.zip', 'Claude export', 2]], 'both exports in Downloads, counted; a zip of photos is not an export');
  // an import reads the same files: afterwards every source file is as it was
  const { v } = newVault();
  await runFullImport(v, OWNER, { history: [...ALL, ...exportsFound.map((s) => s.id)], env });
  v.close();
  assert.deepEqual(snapshot(), before, 'no source file was changed, moved, added or removed');
});

test('history formats: each conversation is one note with its title, date and turns in order; tool output is one short line', async () => {
  const { env } = makeHome();
  const { v } = newVault();
  const exports = (await scanHistory({ env })).filter((s) => s.kind === 'export').map((s) => s.id);
  const r = await runFullImport(v, OWNER, { history: [...ALL, ...exports], env });
  assert.equal(r.conversations, 12, JSON.stringify(r));

  const gpt = bodyOf(v, 'chatgpt');
  assert.match(gpt, /^# Zephyrquokka garden plan$/m);
  assert.match(gpt, /^Started: 2026-01-01T00:00:00\.000Z$/m, 'create_time in seconds');
  assert.ok(gpt.indexOf('How do I plant zephyrquokka seeds?') < gpt.indexOf('Plant them in spring'), 'turns in order');
  assert.ok(!gpt.includes('The newest answer, on a branch'), 'only the branch that leads to current_node, not the newest leaf');
  assert.ok(gpt.includes('[tool call: web]') && gpt.includes('[tool output: web]'), 'the tool shows as short lines');
  assert.ok(!gpt.includes('a long page of search results'), 'the tool output itself is left out');
  assert.ok(gpt.includes('[image attached]'));
  assert.ok(gpt.includes('Polka, nearly.'), 'with no current_node the newest leaf is followed');

  const cl = bodyOf(v, 'claude');
  assert.match(cl, /^# Zephyrquokka naming$/m);
  assert.match(cl, /^Project: Quokka brand$/m, 'the project named from projects.json');
  assert.ok(cl.includes('How about Quokkaflow?') && cl.includes('[tool call: artifacts: Name ideas]') && cl.includes('[attachment: brief.txt]'));
  assert.ok(!cl.includes('private reasoning') && !cl.includes('a long artifact body'), 'thinking and tool bodies are left out');
  assert.ok(cl.includes('Hello from an older export.'), 'an older export with message text only');

  const cc = bodyOf(v, 'claude-code');
  assert.match(cc, /^# Fix zephyrquokka test$/m, 'the session title');
  assert.match(cc, /^Project: \/home\/user\/zephyr$/m, 'the project from the session cwd');
  assert.ok(cc.indexOf('Fix the zephyrquokka test') < cc.indexOf('[tool call: Bash]') && cc.indexOf('[tool call: Bash]') < cc.indexOf('The test expected two quokkas'));
  for (const gone of ['very long tool output', 'Caveat: injected', 'A subagent turn', 'left out']) assert.ok(!cc.includes(gone), `${gone} is not imported`);
  assert.ok(cc.includes('[command: /clear]'));
  assert.ok(notesOf(v).some((p) => p.startsWith(`${HISTORY_DIR}/claude-code/home-user-zephyr/2026-11-01-fix-zephyrquokka-test-`)), 'grouped by app and project');

  const cx = bodyOf(v, 'codex');
  assert.ok(cx.includes('Rename the quokka module') && cx.includes('Renamed quokka.js to marsupial.js.') && cx.includes('[tool call: shell]'));
  assert.ok(!cx.includes('environment_context') && !cx.includes('AGENTS.md') && !cx.includes('long shell output'));
  assert.equal(cx.split('Renamed quokka.js').length - 1, 1, 'the event_msg copy of the reply is not read');
  assert.match(cx, /^Project: \/home\/user\/zephyr$/m);

  const gm = bodyOf(v, 'gemini-cli');
  assert.match(gm, /^# Quokkas in a zephyr$/m, 'the summary set by a $set line');
  assert.match(gm, /^Project: \/home\/user\/zephyr$/m, 'the project named by .project_root');
  assert.ok(gm.includes('Seven, if they are small.') && gm.includes('[tool call: google_web_search]'), 'a $patch line replaces the content');
  for (const gone of ['rewound', 'First try', 'search results that must', 'Request cancelled', 'later removed', 'Draft']) assert.ok(!gm.includes(gone), `${gone} is not imported`);
  assert.ok(gm.includes('Older single-file session'));

  const qw = bodyOf(v, 'qwen-code');
  assert.ok(qw.includes('List the quokka files') && qw.includes('[tool call: list_directory]') && qw.includes('There is one: quokka.js.'));
  assert.ok(!qw.includes('thinking that is left out') && !qw.includes('"output"'));

  const jn = bodyOf(v, 'jan');
  assert.match(jn, /^# Quokka facts$/m);
  assert.ok(jn.indexOf('Tell me a quokka fact') < jn.indexOf('Quokkas live on Rottnest Island.'));
  assert.match(jn, /^### User \(2025-06-27 08:23\)$/m, 'created_at in milliseconds');

  const co = bodyOf(v, 'continue');
  assert.ok(co.includes('Refactor the quokka loop') && co.includes('[tool call: read_file]') && co.includes('Done: the loop is a map now.'));
  assert.ok(!co.includes('file contents that must not'));
  assert.match(co, /^Started: 2025-11-04/m, 'the date from the session index');

  const cn = bodyOf(v, 'cline');
  assert.ok(cn.includes('Add a quokka counter') && cn.includes('[tool call: read_file]') && cn.includes('Added the counter.'));
  assert.ok(!cn.includes('lots of detail') && !cn.includes('file body that must not') && !cn.includes('<task>'));
  v.close();
});

test('history import is idempotent: the same conversation never makes two notes, even renamed in a later export', async () => {
  const { home, env } = makeHome();
  const { v } = newVault();
  const exportId = `export:${path.join(home, 'Downloads', 'chatgpt-export.zip')}`;
  const r1 = await runFullImport(v, OWNER, { history: ['claude-code', exportId], env });
  assert.equal(r1.conversations, 3);
  const n1 = notesOf(v).length;
  const r2 = await runFullImport(v, OWNER, { history: ['claude-code', exportId], env });
  assert.equal(r2.conversations, 0, 'nothing new');
  assert.equal(r2.already, 3, 'all three counted as already imported');
  assert.equal(r2.id, null, 'no empty import is recorded');
  // a newer export of the same account: the conversation was renamed, and its id is the same
  const renamed = JSON.parse(fixture('chatgpt-conversations.json')); renamed[0].title = 'Renamed garden plan';
  const later = put(path.join(home, 'Downloads', 'chatgpt-export-later.zip'), makeZip([{ name: 'conversations.json', data: JSON.stringify(renamed) }]));
  const r3 = await runFullImport(v, OWNER, { history: [`export:${later}`], env });
  assert.equal(r3.conversations, 0, 'the renamed conversation is the same conversation');
  assert.equal(notesOf(v).length, n1);
  assert.equal(listImports(v).length, 1, 'one import recorded');
  v.close();
});

test('history secrets: a conversation that looks like it holds a secret is skipped and counted, the rest are imported', async () => {
  const home = tmpdir('hist-sec-');
  const leaky = JSON.parse(fixture('claude-conversations.json'));
  leaky[1].chat_messages[0].text = `my key is ${FAKE_KEY}`;
  const zip = put(path.join(home, 'export.zip'), makeZip([{ name: 'conversations.json', data: JSON.stringify(leaky) }]));
  const { v } = newVault();
  const preview = await walkHistory(v, OWNER, [`export:${zip}`], { env: { HOME: home } });
  assert.equal(preview.counts.secret, 1);
  assert.ok(preview.listed.some((x) => x.reason === 'secret' && x.title === 'Old export with text only'), 'named by title only');
  assert.ok(!JSON.stringify(preview).includes(FAKE_KEY), 'the secret itself is never shown');
  const r = await runFullImport(v, OWNER, { history: [`export:${zip}`], env: { HOME: home } });
  assert.equal(r.conversations, 1);
  assert.equal(r.secret, 1);
  for (const p of notesOf(v)) assert.ok(!v.get(OWNER, p).body.includes(FAKE_KEY));
  v.close();
});

test('history big export: a 30 MB conversations.json streams one conversation at a time; only an oversized one is skipped', async () => {
  const home = tmpdir('hist-big-');
  const base = JSON.parse(fixture('chatgpt-conversations.json'))[1];
  const convs = [];
  for (let i = 0; i < 6000; i++) convs.push({ ...base, conversation_id: `conv-${i}`, id: `conv-${i}`, title: `Conversation ${i}`, mapping: { ...base.mapping, pad: { id: 'pad', parent: null, message: null, filler: 'x'.repeat(4500) } } });
  const huge = { ...base, conversation_id: 'huge', id: 'huge', title: 'Huge', mapping: { ...base.mapping, pad: { id: 'pad', parent: null, message: null, filler: 'y'.repeat(3 * 1024 * 1024) } } };
  convs.splice(3000, 0, huge);
  const data = Buffer.from(JSON.stringify(convs));
  assert.ok(data.length > 30 * 1024 * 1024, `${data.length} bytes`);
  const zip = put(path.join(home, 'export.zip'), makeZip([{ name: 'conversations.json', data }]));
  convs.length = 0;
  global.gc?.();
  const rss0 = process.memoryUsage().rss;
  let count = 0, skipped = 0, peak = rss0;
  for await (const r of exportConversations(zip, { maxItemBytes: 1024 * 1024 })) {
    if (r.skip) { skipped++; assert.equal(r.skip, 'too large'); } else count++;
    if (count % 500 === 0) peak = Math.max(peak, process.memoryUsage().rss);
  }
  assert.equal(count, 6000, 'every conversation read');
  assert.equal(skipped, 1, 'only the one over the limit skipped');
  assert.ok(peak - rss0 < data.length, `memory grew ${Math.round((peak - rss0) / 1e6)} MB for a ${Math.round(data.length / 1e6)} MB file`);
  const s = (await scanHistory({ env: { HOME: home }, exports: [zip], findDownloads: false, maxItemBytes: 1024 * 1024 }))[0];
  assert.equal(s.count, 6000);
  assert.equal(s.too_large, 1, 'the scan reports the skip count');
});

test('history JSON stream: elements split across any chunk size, strings holding brackets, a byte order mark, and an oversized element', async () => {
  const text = '﻿[{"a":"x]}\\"é,"},[1,[2]],"s\\"]",12,true,null,{"big":"' + 'z'.repeat(50) + '"},{"b":2}]';
  const want = ['{"a":"x]}\\"é,"}', '[1,[2]]', '"s\\"]"', '12', 'true', 'null', 'BIG', '{"b":2}'];
  for (const n of [1, 2, 3, 5, 64, 4096]) {
    const buf = Buffer.from(text); const chunks = [];
    for (let i = 0; i < buf.length; i += n) chunks.push(buf.subarray(i, i + n));
    const got = [];
    for await (const x of jsonArrayItems(Readable.from(chunks), { maxItemBytes: 40 })) got.push(x.tooLarge ? 'BIG' : JSON.stringify(x.value));
    assert.deepEqual(got, want, `chunk size ${n}`);
  }
  await assert.rejects(async () => { for await (const _ of jsonArrayItems(Readable.from([Buffer.from('[{"a":1}')]))) { /* drain */ } }, /ends early/);
});

test('history sharded and unpacked exports: conversations-000.json and on, in a folder, are read in order', async () => {
  const dir = tmpdir('hist-shard-');
  const all = JSON.parse(fixture('chatgpt-conversations.json'));
  put(path.join(dir, 'conversations-000.json'), JSON.stringify([all[0]]));
  put(path.join(dir, 'conversations-001.json'), JSON.stringify([all[1]]));
  put(path.join(dir, 'export_manifest.json'), JSON.stringify({ version: 1, logical_files: { 'conversations.json': { files: ['conversations-000.json', 'conversations-001.json'], sharded: true, shard_count: 2 } } }));
  const titles = [];
  for await (const r of exportConversations(dir)) titles.push(r.conv.title);
  assert.deepEqual(titles, ['Zephyrquokka garden plan', 'No current node']);
});

test('history zip reader: lists the central directory and streams one entry without reading the rest', async () => {
  const dir = tmpdir('hist-zip-');
  const f = put(path.join(dir, 'a.zip'), makeZip([{ name: 'conversations.json', data: '[]' }, { name: 'file_00-photo.dat', data: Buffer.alloc(1000, 7) }]));
  const entries = listZip(f);
  assert.deepEqual(entries.map((e) => [e.name, e.size]), [['conversations.json', 2], ['file_00-photo.dat', 1000]]);
  const chunks = []; for await (const c of entryStream(f, entries[0])) chunks.push(c);
  assert.equal(Buffer.concat(chunks).toString(), '[]');
  assert.throws(() => listZip(put(path.join(dir, 'b.zip'), 'not a zip')), /not a zip/);
});

test('history Gemini replay: a rewind drops that message and after, a patch edits or removes, a repeated id replaces', () => {
  const s = geminiReplay([
    { sessionId: 's', startTime: 't0' },
    { id: '1', type: 'user', content: 'a' }, { id: '2', type: 'gemini', content: 'b' }, { id: '3', type: 'user', content: 'c' },
    { $rewindTo: '2' },
    { id: '4', type: 'gemini', content: 'd' }, { id: '4', type: 'gemini', content: 'd2' },
    { id: '5', type: 'user', content: 'e' },
    { $patch: { updates: [{ id: '1', content: 'a2' }], removeIds: ['5'] } },
    { $set: { summary: 'S' } },
  ]);
  assert.deepEqual(s.messages.map((m) => `${m.id}:${m.content}`), ['1:a2', '4:d2']);
  assert.equal(s.summary, 'S');
});

test('history undo: removes every conversation note of that import and its record, and nothing else; a new import then works', async () => {
  const { env } = makeHome();
  const { v } = newVault();
  v.write(OWNER, { path: 'memory/keep.md', body: '# Mine\nmy own note\n' });
  const a = await runFullImport(v, OWNER, { history: ['claude-code', 'codex'], env });
  const b = await runFullImport(v, OWNER, { history: ['jan'], env });
  assert.deepEqual(listImports(v).map((x) => [x.id, x.items]).sort(), [[a.id, 2], [b.id, 1]].sort(), 'list counts conversations');
  const u = undoImport(v, OWNER, a.id);
  assert.equal(u.ok, true); assert.equal(u.conversations, 2);
  assert.equal(notesOf(v).length, 1, 'only the other import remains');
  assert.ok(notesOf(v)[0].startsWith(`${HISTORY_DIR}/jan/`));
  assert.ok(v.allNotes().includes('memory/keep.md'), 'a note of my own is untouched');
  assert.equal(undoImport(v, OWNER, a.id).ok, false, 'a second undo finds nothing');
  const again = await runFullImport(v, OWNER, { history: ['claude-code', 'codex'], env });
  assert.equal(again.conversations, 2, 'after undo the conversations can be imported again');
  v.close();
});

test('history scan --json: memev import scan --json lists every source with id, app, path, count, size, dates and a mark, and imports nothing', () => {
  const sb = sandbox();
  const { home } = { home: sb.home };
  // the fixtures go into the sandbox home itself
  const src = makeHome().home;
  fs.cpSync(src, home, { recursive: true });
  const r = sb.run(['import', 'scan', '--json']);
  assert.equal(r.code, 0, r.err + r.out);
  const out = JSON.parse(r.out);
  assert.equal(typeof out.mark_max, 'number');
  const ids = out.sources.map((s) => s.id);
  for (const id of ALL) assert.ok(ids.includes(id), `${id} in ${ids.join(', ')}`);
  for (const s of out.sources) {
    for (const k of ['id', 'app', 'kind', 'path', 'count', 'bytes', 'first', 'last', 'marked']) assert.ok(k in s, `${s.id} has ${k}`);
    assert.equal(s.marked, s.count !== null && s.count > 0 && s.count <= out.mark_max);
  }
  assert.ok(out.sources.some((s) => s.kind === 'export' && s.app === 'ChatGPT export' && s.count === 2));
  assert.ok(!fs.existsSync(path.join(sb.root, 'memory')), 'no vault was made or written');
  const q = JSON.parse(sb.run(['import', 'scan', '--quick', '--json']).out);
  assert.ok(q.sources.filter((s) => s.kind === 'export').every((s) => s.count === null && s.marked === false), 'quick lists a found export by size only, unmarked');
});

test('history CLI: memev import --source A --source B --yes imports the chosen sources only; --preview imports nothing', async () => {
  const { env } = makeHome();
  const { root, v } = newVault(); v.close();
  const { command } = await import('../src/cli/import.mjs');
  const lines = []; const log = console.log; console.log = (...a) => lines.push(a.join(' '));
  try {
    assert.equal(await command('import', [], { source: ['codex', 'jan'], preview: true }, { root, env }), 0);
    assert.match(lines.join('\n'), /codex:\n {2}1 conversation\(s\) found, 1 to import/);
    assert.match(lines.join('\n'), /Preview only\. Nothing imported\./);
    lines.length = 0;
    assert.equal(await command('import', [], { source: ['codex', 'jan'], yes: true }, { root, env }), 0);
    assert.match(lines.join('\n'), /Imported 2 item\(s\) as imp-[0-9a-f]{8} \(0 skipped; 2 conversation\(s\)\)/);
    lines.length = 0;
    assert.equal(await command('import', [], { source: 'codex,jan', yes: true }, { root, env }), 0);
    assert.match(lines.join('\n'), /Nothing to import\./, 'a second run imports nothing');
    lines.length = 0;
    assert.equal(await command('import', ['list'], {}, { root, env }), 0);
    assert.match(lines.join('\n'), /imp-[0-9a-f]{8} {2}2 item\(s\), 2 of them conversations/);
  } finally { console.log = log; }
  const v2 = new (await import('../src/engine/vault.mjs')).Vault(root).open();
  try { assert.deepEqual(notesOf(v2).map((p) => p.split('/')[3]).sort(), ['codex', 'jan']); } finally { v2.close(); }
});

test('history setup offer: lists what the scan found, marks small sources, leaves a big one unmarked, and y imports only the marked', async () => {
  const { home, env } = makeHome();
  const { v } = newVault();
  const sources = await scanSources({ env, quick: true, markMax: 1 });
  const gem = sources.find((s) => s.id === 'gemini-cli');
  assert.equal(gem.marked, false, 'two sessions are over a limit of one');
  assert.equal(sources.find((s) => s.id === 'codex').marked, true);
  assert.match(sourceList(sources, { markMax: 1 }), /\d+\. \[ \] Gemini CLI: 2 sessions/);
  assert.deepEqual(chooseSources(sources, '').map((s) => s.id), [], 'Enter chooses nothing');
  assert.deepEqual(chooseSources(sources, 'n'), []);
  assert.equal(chooseSources(sources, 'all').length, sources.length);
  assert.deepEqual(chooseSources(sources, '1,2').map((s) => s.id), sources.slice(0, 2).map((s) => s.id));

  const input = new PassThrough(); const output = new PassThrough();
  input.end('y\n');
  const { offerImport } = await import('../src/cli/import.mjs');
  const r = await offerImport({ root: v.root, env, flags: {}, ask: true, input, output, cwd: tmpdir('empty-cwd-'), home });
  const shown = String(output.read() || '');
  assert.match(shown, /History found on this computer/);
  assert.match(shown, /\[x\] Claude Code: 1 sessions/);
  assert.match(shown, /\[ \] Chat export \(.*chatgpt-export\.zip\): .*not counted yet/, 'an export in Downloads is listed by size at setup and not marked');
  assert.match(shown, /Import these items\? \[y\/N\]/);
  assert.equal(r.accepted, true);
  assert.ok(!r.chosen.some((id) => id.startsWith('export:')), 'y leaves the unmarked export out');
  assert.equal(r.result.conversations, 8, "every conversation of the marked apps (Gemini CLI holds two)");
  v.close();
});

test('history project choice: claude-code/<project folder> imports that project only', async () => {
  const { home, env } = makeHome();
  put(path.join(home, '.claude', 'projects', '-home-user-other', '5e550000-0000-4000-8000-000000000009.jsonl'), fixture('claude-code-session.jsonl').toString().replaceAll('5e550000-0000-4000-8000-000000000001', '5e550000-0000-4000-8000-000000000009'));
  const { v } = newVault();
  const one = await walkHistory(v, OWNER, ['claude-code/-home-user-other'], { env });
  assert.equal(one.counts.found, 1);
  const all = await walkHistory(v, OWNER, ['claude-code'], { env });
  assert.equal(all.counts.found, 2);
  v.close();
});
