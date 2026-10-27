// SPDX-License-Identifier: Apache-2.0
// A lossless line splice: the smallest single replaced range between two texts (common prefix and suffix
// kept). Applying it to the old text gives the new text exactly. Typical edits (an added paragraph, a
// changed line) cost the size of the change, not the size of the note.
export function lineSplice(oldText, newText) {
  const a = oldText.split('\n'), b = newText.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let ea = a.length, eb = b.length;
  while (ea > start && eb > start && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  return { at: start, del: ea - start, ins: b.slice(start, eb) };
}
export function applySplice(text, { at, del, ins }) {
  const a = text.split('\n');
  a.splice(at, del, ...ins);
  return a.join('\n');
}
