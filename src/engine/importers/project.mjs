// SPDX-License-Identifier: Apache-2.0
// Scan a project folder for importable content: README, docs markdown, notes, and git log subjects.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { findSecrets } from '../secrets.mjs';

const SKIP_DIRS = new Set(['node_modules', 'vendor', 'dist', 'build', '.git', '.memev', 'coverage', '.next', '__pycache__']);
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.pdf', '.zip', '.tar', '.gz', '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mp3', '.wav', '.exe', '.dll', '.so', '.dylib', '.class', '.jar', '.wasm', '.lock']);

function isSecretFile(name) {
  const n = name.toLowerCase();
  return n === '.env' || n === '.env.local' || n === '.env.production' || n === '.env.development'
    || n.endsWith('.pem') || n.endsWith('.key') || n.endsWith('.p12') || n.endsWith('.pfx')
    || n === 'id_rsa' || n === 'id_ed25519' || n === 'credentials.json' || n === 'secrets.json';
}

function walk(dir, rel, items) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (e.name.startsWith('.') && e.name !== '.env') continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), r, items);
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      if (SKIP_EXT.has(ext)) continue;
      if (isSecretFile(e.name)) {
        items.push({ title: r, source: 'project', sourcePath: path.join(dir, e.name), content: null, size: null, skip: true, reason: 'secret' });
        continue;
      }
      const isMd = ext === '.md' || ext === '.markdown';
      const isReadme = e.name.toLowerCase() === 'readme' || e.name.toLowerCase() === 'readme.md' || e.name.toLowerCase() === 'readme.markdown';
      const inDocs = /^docs\//i.test(r) || /^documentation\//i.test(r);
      const inNotes = /^notes\//i.test(r) || /^note\//i.test(r);
      if (isReadme || (isMd && (inDocs || inNotes)) || (isMd && r.split('/').length <= 2)) {
        try {
          const fp = path.join(dir, e.name);
          const content = fs.readFileSync(fp, 'utf8');
          const hits = findSecrets(content);
          if (hits.length) {
            items.push({ title: r, source: 'project', sourcePath: fp, content: null, size: null, skip: true, reason: 'secret' });
          } else {
            const size = Buffer.byteLength(content);
            if (size > 0 && size <= 512 * 1024) {
              items.push({ title: r, source: 'project', sourcePath: fp, content, size, skip: false, reason: null });
            }
          }
        } catch {}
      }
    }
  }
}

function gitLogSubjects(dir) {
  try {
    const out = execFileSync('git', ['log', '--pretty=%s', '-n', '50'], { windowsHide: true, cwd: dir, encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (!out) return null;
    const lines = out.split('\n').filter(Boolean);
    if (!lines.length) return null;
    return lines.join('\n');
  } catch { return null; }
}

export function scanProject(dir) {
  const items = [];
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return items;
  walk(abs, '', items);
  const log = gitLogSubjects(abs);
  if (log) {
    const size = Buffer.byteLength(log);
    if (size > 0 && size <= 512 * 1024) {
      items.push({ title: 'git log (recent subjects)', source: 'project', sourcePath: abs, content: log, size, skip: false, reason: null });
    }
  }
  return items;
}
