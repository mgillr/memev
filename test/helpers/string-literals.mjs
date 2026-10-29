// Extract the literal text of every string in a JS source: single- and double-quoted
// strings and the literal parts of template literals. Template expressions (${...}) are
// code, not copy, so they are skipped: a negation like `!=` inside one is not an
// exclamation in the user-facing text.

export function stringLiterals(src) {
  const out = [];
  const n = src.length;
  let i = 0;

  const skipExpr = (from) => {
    let depth = 1;
    let j = from;
    while (j < n && depth > 0) {
      const c = src[j];
      if (c === "'" || c === '"' || c === '`') { j = skipString(c, j); continue; }
      if (c === '/' && src[j + 1] === '/') { while (j < n && src[j] !== '\n') j++; continue; }
      if (c === '/' && src[j + 1] === '*') { j += 2; while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++; j++; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      j++;
    }
    return j;
  };

  const skipString = (quote, from) => {
    let j = from + 1;
    while (j < n) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (quote === '`' && c === '$' && src[j + 1] === '{') { j = skipExpr(j + 2); continue; }
      if (c === quote) return j + 1;
      j++;
    }
    return j;
  };

  while (i < n) {
    const c = src[i];
    if (c === "'" || c === '"') {
      const start = i + 1;
      i = skipString(c, i);
      out.push(src.slice(start, i - 1));
      continue;
    }
    if (c === '`') {
      let k = i + 1;
      let buf = '';
      while (k < n) {
        const ch = src[k];
        if (ch === '\\') { buf += src[k + 1] ?? ''; k += 2; continue; }
        if (ch === '$' && src[k + 1] === '{') { if (buf) { out.push(buf); buf = ''; } k = skipExpr(k + 2); continue; }
        if (ch === '`') break;
        buf += ch;
        k++;
      }
      if (buf) out.push(buf);
      i = k + 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    i++;
  }
  return out;
}
