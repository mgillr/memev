// A new note no longer reads every live head to find a case twin, and the promise of issue 243 stays: a name that differs from a live
// note only in letter case or Unicode form is refused the same way, on every file system, because the check is string logic and not
// the disk's. The vault runs without git. The old check, kept here word for word as the oracle, decides every generated path, and a
// deliberately broken check shows the comparison can fail.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { newVault, cleanup, OWNER } from './helpers/tmp.mjs';
after(cleanup);

/** The check as it was: reads every live head. Returns the message it would throw, or null. */
function oldCheck(heads, p) {
  const h = heads.get(p); if (h && !h.deleted) return null;
  const fold = (x) => x.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC');
  const segs = p.split('/'); const want = []; let acc = '';
  for (const sg of segs) { acc = acc ? `${acc}/${sg}` : sg; want.push([acc, fold(acc)]); }
  for (const [q, hq] of heads) {
    if (hq.deleted || q === p) continue;
    const qs = q.split('/'); let qa = '';
    for (let i = 0; i < Math.min(qs.length, want.length); i++) {
      qa = qa ? `${qa}/${qs[i]}` : qs[i];
      const [mine, key] = want[i];
      if (qa === mine) continue;
      if (fold(qa) === key && (i < segs.length - 1 ? i < qs.length - 1 : i === qs.length - 1)) return `${mine} differs from the existing ${i < qs.length - 1 ? 'folder' : 'note'} ${qa} only in letter case or Unicode form; a case-insensitive disk keeps them as one, so use the spelling ${qa}`;
      break;
    }
  }
  return null;
}
/** Broken on purpose: compares with toLowerCase alone, so it misses the long s, the Kelvin sign, the sharp s and the decomposed forms. */
function brokenCheck(heads, p) {
  const h = heads.get(p); if (h && !h.deleted) return null;
  for (const [q, hq] of heads) if (!hq.deleted && q !== p && q.toLowerCase() === p.toLowerCase()) return q;
  return null;
}
const answer = (v, p) => { try { v._noCaseTwin(p); return null; } catch (e) { assert.equal(e.code, 'bad_path'); return e.message; } };

/** Counts every time something walks the log's heads. */
class CountingHeads extends Map {
  walks = 0;
  [Symbol.iterator]() { this.walks++; return super[Symbol.iterator](); }
  entries() { this.walks++; return super.entries(); }
  keys() { this.walks++; return super.keys(); }
  values() { this.walks++; return super.values(); }
  forEach(...a) { this.walks++; return super.forEach(...a); }
}

test('a new note does not read every live head once the first new note has been checked', () => {
  const { v } = newVault({ git: false });
  try {
    v.write(OWNER, { path: 'notes/a.md', body: '# A\n' });
    const counted = new CountingHeads(v.log.heads); v.log.heads = counted;
    v.write(OWNER, { path: 'notes/first.md', body: '# first\n' });
    counted.walks = 0;
    for (let i = 0; i < 20; i++) {
      v.write(OWNER, { path: `notes/deep/n${i}.md`, body: `# n ${i}\n` });
      v.append(OWNER, { path: `work/sessions/s${i}.md`, text: `turn ${i}` });
    }
    assert.equal(counted.walks, 0, 'a new note walked the heads');
    // and a twin is still refused, naming the existing note, which is the one case that reads them
    assert.throws(() => v.write(OWNER, { path: 'NOTES/deep/N3.md', body: 'x\n' }), (e) => e.code === 'bad_path' && e.message.includes('existing folder notes '));
    assert.throws(() => v.write(OWNER, { path: 'notes/deep/N3.md', body: 'x\n' }), (e) => e.code === 'bad_path' && e.message.includes('notes/deep/n3.md'));
  } finally { v.close(); }
});

test('a twin made right after the check is built, and one freed by a delete, are both seen without a reopen', () => {
  const { v } = newVault({ git: false });
  try {
    v.write(OWNER, { path: 'notes/one.md', body: '# one\n' }); // builds it
    v.write(OWNER, { path: 'notes/two.md', body: '# two\n' });
    assert.throws(() => v.write(OWNER, { path: 'notes/TWO.md', body: 'x\n' }), (e) => e.code === 'bad_path');
    v.delete(OWNER, { path: 'notes/two.md' });
    assert.ok(v.write(OWNER, { path: 'notes/TWO.md', body: '# again\n' }).seq, 'the freed name was refused');
    assert.throws(() => v.write(OWNER, { path: 'notes/two.md', body: 'x\n' }), (e) => e.code === 'bad_path' && e.message.includes('notes/TWO.md'));
    // the last note in a folder going frees the folder's spelling too
    v.write(OWNER, { path: 'lone/x.md', body: '# x\n' });
    assert.throws(() => v.write(OWNER, { path: 'LONE/y.md', body: 'x\n' }), (e) => e.code === 'bad_path');
    v.delete(OWNER, { path: 'lone/x.md' });
    assert.ok(v.write(OWNER, { path: 'LONE/y.md', body: '# y\n' }).seq, 'the freed folder spelling was refused');
  } finally { v.close(); }
});

test('the new check answers exactly as the old one over generated names, and a broken check is caught by the same comparison', () => {
  const { v } = newVault({ git: false });
  try {
    // every spelling trap the fold has: case, decomposed accents, final sigma, long s, sharp s, Kelvin, Turkish dotted I, ligature
    const stems = ['a', 'A', 'café', 'café', 'CAFÉ', 'οδος', 'οδοσ', 'ΟΔΟΣ', 'sun', 'ſun', 'SUN', 'straße', 'STRASSE', 'strasse', 'kelvin', 'Kelvin', 'KELVIN', 'i', 'I', 'İ', 'ı', 'fi', 'ﬁ', 'FI', 'notes', 'Notes'];
    const folders = ['notes', 'Notes', 'NOTES', 'notes/sub', 'notes/Sub', 'notes/a', 'Notes/a', 'café', 'café', 'work/ſun', 'work/sun', 'a'];
    const paths = []; for (const f of folders) for (const s of stems) paths.push(`${f}/${s}.md`, `${f}/${s}`);
    for (const s of stems) paths.push(`${s}.md`, s);
    let seed = 7; const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed % n; };
    let compared = 0, refusals = 0, brokenDiffers = 0, written = 0, deleted = 0;
    v.write(OWNER, { path: 'start.md', body: 'x\n' }); // builds the check, so the writes below keep it current
    for (let i = 0; i < 1500; i++) {
      const p = paths[rnd(paths.length)];
      const was = oldCheck(v.log.heads, p); const now = answer(v, p);
      assert.equal(now, was, `differs on ${JSON.stringify(p)}`);
      compared++; if (was) refusals++;
      if (!was !== !brokenCheck(v.log.heads, p)) brokenDiffers++;
      // grow and shrink the vault as the answers allow, so every state is checked. A path the disk refuses is an expected refusal.
      const live = [...v.log.heads].filter(([, h]) => !h.deleted).map(([q]) => q);
      if (live.length > 3 && rnd(5) === 0) { const q = live[rnd(live.length)]; try { v.delete(OWNER, { path: q }); deleted++; } catch { /* not there on this disk */ } } else if (!was) { try { v.write(OWNER, { path: p, body: `# ${i}\n` }); written++; } catch (e) { assert.ok(['bad_path', 'immutable', 'secret'].includes(e.code) || /EEXIST|ENOTDIR|EISDIR/.test(e.code || ''), e.message); } }
    }
    assert.equal(compared, 1500);
    assert.ok(refusals > 100, `only ${refusals} refusals: the sample tests little`);
    assert.ok(written > 50 && deleted > 50, `written ${written}, deleted ${deleted}`);
    assert.ok(brokenDiffers > 0, 'the broken check was not caught, so this comparison cannot fail');
  } finally { v.close(); }
});
