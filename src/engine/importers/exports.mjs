// SPDX-License-Identifier: Apache-2.0
// Read ChatGPT and Claude chat export zips: find conversations.json and extract readable text.
import fs from 'node:fs';
import path from 'node:path';
import { readZip } from '../zip.mjs';
import { findSecrets } from '../secrets.mjs';

const MAX_SIZE = 512 * 1024;

function extractText(entry) {
  try {
    const data = JSON.parse(entry.data.toString('utf8'));
    const lines = [];
    const walk = (obj) => {
      if (Array.isArray(obj)) { for (const v of obj) walk(v); return; }
      if (obj && typeof obj === 'object') {
        const role = obj.role || obj.author || obj.from;
        const text = obj.content || obj.text || obj.message;
        if (role && text && typeof text === 'string' && text.trim()) {
          lines.push(`[${role}] ${text.trim()}`);
        }
        for (const v of Object.values(obj)) walk(v);
      }
    };
    walk(data);
    return lines.join('\n');
  } catch { return null; }
}

export function scanExport(file) {
  const items = [];
  let buf;
  try { buf = fs.readFileSync(file); } catch { return items; }
  let entries;
  try { entries = readZip(buf); } catch { return items; }
  for (const e of entries) {
    const name = e.name.toLowerCase();
    if (!name.endsWith('.json')) continue;
    if (!/conversation|chat|message|export/.test(name)) continue;
    if (e.size > MAX_SIZE) continue;
    const text = extractText(e);
    if (!text || !text.trim()) continue;
    if (findSecrets(text).length) {
      items.push({ title: path.basename(file), source: 'export', sourcePath: file, content: null, size: null, skip: true, reason: 'secret' });
      return items;
    }
    items.push({ title: path.basename(file), source: 'export', sourcePath: file, content: text, size: Buffer.byteLength(text), skip: false, reason: null });
    return items;
  }
  return items;
}
