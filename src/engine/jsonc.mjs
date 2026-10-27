// SPDX-License-Identifier: Apache-2.0
// Settings files that hold comments or trailing commas (JSONC: VS Code, Zed, often Gemini CLI). Memev's change is
// written as edits to the text, one key or list element at a time, so every comment, blank line and the layout of the
// rest of the file stay as they were, and taking Memev out again gives back the text it found.
import { parse, parseTree, findNodeAtLocation, modify, applyEdits, printParseErrorCode } from '../../vendor/jsonc/main.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const OPTS = { allowTrailingComma: true, disallowComments: false };

/** The object a JSONC text holds; throws when the text is not valid JSONC or not an object. */
export function parseJsonc(text) {
  const errors = [];
  const value = parse(text, errors, OPTS);
  if (errors.length) throw new Error(`is not valid JSON with comments (${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset})`);
  if (!isObj(value)) throw new Error('is not a JSON object');
  return value;
}

const lineStart = (t, i) => t.lastIndexOf('\n', i - 1) + 1;
const lineEnd = (t, i) => { const n = t.indexOf('\n', i); return n < 0 ? t.length : t[n - 1] === '\r' ? n - 1 : n; };
const indentAt = (t, i) => /^[ \t]*/.exec(t.slice(lineStart(t, i)))[0];
const blank = (s) => /^[ \t\r\n]*$/.test(s);
// what may follow an item on its own line: a comma, then a comment
const TAIL = /^[ \t]*(,?)[ \t]*(?:\/\/.*|\/\*.*?\*\/[ \t]*)?$/;

/** `text` with `prev` (what it holds) turned into `next`, changing only the keys and elements that differ. */
export function editJsonc(text, prev, next) {
  const unit = /^([ \t]+)\S/m.exec(text)?.[1] || '  ';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let out = text;
  const tree = () => parseTree(out, [], OPTS);
  const pretty = (v, indent) => JSON.stringify(v, null, unit).replace(/\n/g, `${eol}${indent}`);
  const label = (key) => (typeof key === 'number' ? '' : `${JSON.stringify(key)}: `);
  const apply = (edits) => { out = applyEdits(out, edits); };

  // the editor's own edits, for what the line rules below do not cover; only the text Memev writes is laid out
  const raw = (p, v, opts = {}) => apply(modify(out, p, v, opts).map((e) => {
    if (v === undefined) return { ...e, length: out.slice(e.offset, e.offset + e.length).replace(/\s+$/, '').length };
    const ind = indentAt(out, e.offset); const r = JSON.stringify(v); const item = label(p.at(-1));
    if (e.content === r) return { ...e, content: pretty(v, ind) };
    if (e.content === `,${item}${r}`) return { ...e, content: `,${eol}${ind}${item}${pretty(v, ind)}` };
    if (e.content === `${item}${r}`) return { ...e, content: `${eol}${ind}${unit}${item}${pretty(v, ind + unit)}${eol}${ind}` };
    return e;
  }));

  // a new last item, on a line of its own after the line of the item before it, so that line and its comment stay
  const insert = (p, v) => {
    const box = findNodeAtLocation(tree(), p.slice(0, -1));
    const last = box?.children?.at(-1);
    if (box && (box.type === 'object' || box.type === 'array') && !last && blank(out.slice(box.offset + 1, box.offset + box.length - 1))) {
      const ind = indentAt(out, box.offset); // {} or [] opens onto a line of its own for the item
      return apply([{ offset: box.offset + 1, length: box.length - 2, content: `${eol}${ind}${unit}${label(p.at(-1))}${pretty(v, ind + unit)}${eol}${ind}` }]);
    }
    if (last) {
      const end = last.offset + last.length; const eolAt = lineEnd(out, end); const m = TAIL.exec(out.slice(end, eolAt));
      if (m && blank(out.slice(lineStart(out, last.offset), last.offset))) {
        const ind = indentAt(out, last.offset); const item = `${eol}${ind}${label(p.at(-1))}${pretty(v, ind)}`;
        return apply(m[1] ? [{ offset: eolAt, length: 0, content: `${item},` }] : [{ offset: end, length: 0, content: ',' }, { offset: eolAt, length: 0, content: item }]);
      }
    }
    raw(p, v, typeof p.at(-1) === 'number' ? { isArrayInsertion: true } : {});
  };

  // an item on lines of its own goes with its lines (a comment on them goes with it); the comma it needed before it
  // goes too, and an emptied box closes
  const remove = (p) => {
    const value = findNodeAtLocation(tree(), p); if (!value) return;
    const node = typeof p.at(-1) === 'number' ? value : value.parent; const box = node.parent;
    const start = lineStart(out, node.offset); const end = node.offset + node.length; const eolAt = lineEnd(out, end);
    const m = TAIL.exec(out.slice(end, eolAt));
    if (!m || !blank(out.slice(start, node.offset))) return raw(p, undefined);
    const stop = out.startsWith('\r\n', eolAt) ? eolAt + 2 : out[eolAt] === '\n' ? eolAt + 1 : eolAt;
    const kids = box.children; const before = kids[kids.indexOf(node) - 1];
    const edits = [{ offset: start, length: stop - start, content: '' }];
    if (!before && kids.length === 1 && blank(out.slice(box.offset + 1, start)) && blank(out.slice(stop, box.offset + box.length - 1))) {
      return apply([{ offset: box.offset + 1, length: box.length - 2, content: '' }]);
    }
    if (!m[1] && before) { const c = /^[ \t]*,/.exec(out.slice(before.offset + before.length, start)); if (c) edits.push({ offset: before.offset + before.length + c[0].length - 1, length: 1, content: '' }); }
    apply(edits);
  };

  const walk = (a, b, p) => {
    if (isObj(a) && isObj(b)) {
      for (const k of Object.keys(a)) if (!(k in b)) remove([...p, k]);
      for (const [k, v] of Object.entries(b)) if (!(k in a)) insert([...p, k], v); else if (!same(a[k], v)) walk(a[k], v, [...p, k]);
    } else if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
      b.forEach((v, i) => { if (!same(a[i], v)) walk(a[i], v, [...p, i]); });
    } else if (Array.isArray(a) && Array.isArray(b)) {
      // elements taken out and others added at the end: how hook lists change; the elements kept are not touched
      const keep = []; let j = 0;
      a.forEach((v, i) => { if (j < b.length && same(v, b[j])) { keep.push(i); j++; } });
      for (let i = a.length - 1; i >= 0; i--) if (!keep.includes(i)) remove([...p, i]);
      b.slice(j).forEach((v, n) => insert([...p, keep.length + n], v));
    } else raw(p, b);
  };
  walk(prev, next, []);
  return out;
}

/** Apply `change` (a function from the settings object to the new one) to a JSONC text, keeping its comments. */
export function changeJsonc(text, change) {
  const prev = parseJsonc(text);
  const next = change(structuredClone(prev));
  if (!isObj(next)) throw new Error('is not a JSON object after the change');
  const out = editJsonc(text, prev, next);
  if (!same(parseJsonc(out), next)) throw new Error('could not be edited in place'); // never write a file that reads back differently
  return out;
}
