// SPDX-License-Identifier: Apache-2.0
// The state map: a note, or the state of an agent, as structured state that a provider shim outside the core can hand to the
// engine, and back again with no loss. The core holds only this representation and no convergence logic. It calls nothing
// and decides nothing between two versions: it reads one value and writes one value.
//
// A note becomes a set of lines. Each line is an element with a key made from the hash of its text and the number of times the
// same text appeared before it, so a repeated line is a separate element and an edit to one line leaves every other key as
// it was. The order is kept beside the set, which makes the mapping exact: joining the lines in order gives back the note byte
// for byte, including line endings and the final newline.
import { sha256 } from './util.mjs';

const NOTE = 'memev.note-state/1';
const AGENT = 'memev.agent-state/1';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const bad = (what) => new TypeError(what);

/** The structured state of a note: { schema, order, lines }, where `lines` maps each element key to its text. */
export function noteToState(text) {
  if (typeof text !== 'string') throw bad('a note is text');
  const seen = new Map();
  const order = [];
  const lines = {};
  for (const line of text.split('\n')) {
    const h = sha256(line).slice(0, 16);
    const n = seen.get(h) ?? 0;
    seen.set(h, n + 1);
    const key = `${h}.${n}`;
    order.push(key);
    lines[key] = line;
  }
  return { schema: NOTE, order, lines };
}

/** The note a structured state stands for. */
export function stateToNote(state) {
  if (!isPlainObject(state) || state.schema !== NOTE || !Array.isArray(state.order) || !isPlainObject(state.lines)) {
    throw bad('not the state of a note');
  }
  const out = [];
  for (const key of state.order) {
    if (typeof key !== 'string' || !Object.hasOwn(state.lines, key) || typeof state.lines[key] !== 'string') {
      throw bad(`the state has no line for ${String(key)}`);
    }
    out.push(state.lines[key]);
  }
  return out.join('\n');
}

// A JSON value: null, a boolean, a finite number, a string, an array of values or an object of values.
function checkValue(v, where) {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return;
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw bad(`${where} is not a finite number`); return; }
  if (Array.isArray(v)) { v.forEach((x, i) => checkValue(x, `${where}[${i}]`)); return; }
  if (isPlainObject(v)) { for (const [k, x] of Object.entries(v)) checkValue(x, `${where}.${k}`); return; }
  throw bad(`${where} cannot be kept as plain data`);
}

/** The structured state of an agent's state, a plain object: one field per top-level key, with the key order kept. */
export function agentToState(obj) {
  if (!isPlainObject(obj)) throw bad('the state of an agent is a plain object');
  const order = Object.keys(obj);
  const fields = {};
  if (order.includes('__proto__')) throw bad('a field named __proto__ cannot be kept');
  for (const k of order) { checkValue(obj[k], k); fields[k] = JSON.parse(JSON.stringify(obj[k])); }
  return { schema: AGENT, order, fields };
}

/** The agent state a structured state stands for. */
export function stateToAgent(state) {
  if (!isPlainObject(state) || state.schema !== AGENT || !Array.isArray(state.order) || !isPlainObject(state.fields)) {
    throw bad('not the state of an agent');
  }
  const out = {};
  for (const k of state.order) {
    if (typeof k !== 'string' || k === '__proto__' || !Object.hasOwn(state.fields, k)) throw bad(`the state has no field for ${String(k)}`);
    out[k] = JSON.parse(JSON.stringify(state.fields[k]));
  }
  return out;
}
