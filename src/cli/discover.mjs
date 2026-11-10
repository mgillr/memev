// SPDX-License-Identifier: Apache-2.0
// memev discover: every AI app on this computer, from names only. It reads registry values (DisplayName, DisplayVersion,
// InstallLocation, DisplayIcon), folder listings and file kinds; it never runs an app and never opens a file. On Windows the
// one process it starts is the system reg.exe, once per Uninstall hive, without a shell and with a time limit.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { clientDefs, unsupportedDefs, osDirs } from './clients.mjs';

export const HIVES = ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'];
export const REG_EXE = 'C:\\Windows\\System32\\reg.exe';
export const REG_TIMEOUT_MS = 8000;
const VALUES = ['DisplayName', 'DisplayVersion', 'InstallLocation', 'DisplayIcon'];

// How each app is found besides the config folder it already had (its detect()): reg, a DisplayName pattern in Uninstall;
// msix, a package family prefix in %LOCALAPPDATA%\Packages; win, folders under lad (Local), ad (Roaming) or pf (Program
// Files); mac, an .app bundle in /Applications or ~/Applications; sup, a folder in ~/Library/Application Support; desk, a
// Linux .desktop file; bin, a command on PATH. An app with {} is found by its config folder alone.
export const PROBES = {
  'claude-code': { bin: ['claude'] }, codex: { bin: ['codex'] }, 'gemini-cli': { bin: ['gemini'] },
  cursor: { reg: /^Cursor\b/, win: ['lad:Programs/cursor'], mac: ['Cursor'], desk: ['cursor'], bin: ['cursor'] },
  'claude-desktop': { reg: /^Claude$/, msix: ['Claude_'], win: ['lad:AnthropicClaude'], mac: ['Claude'] },
  windsurf: { reg: /^Windsurf\b/, win: ['lad:Programs/Windsurf'], mac: ['Windsurf'], desk: ['windsurf'], bin: ['windsurf'] },
  vscode: { reg: /^Microsoft Visual Studio Code\b/, win: ['lad:Programs/Microsoft VS Code'], mac: ['Visual Studio Code'], desk: ['code'], bin: ['code'] },
  zed: { reg: /^Zed\b/, mac: ['Zed'], desk: ['dev.zed.Zed'], bin: ['zed'] },
  opencode: { bin: ['opencode'] }, 'copilot-cli': { bin: ['copilot'] }, 'grok-build': { bin: ['grok'] },
  'chatgpt-desktop': { reg: /^ChatGPT$/, msix: ['OpenAI.ChatGPT-Desktop_'], mac: ['ChatGPT'] },
  'qwen-code': { bin: ['qwen'] }, 'kimi-code': { bin: ['kimi'] }, 'factory-droid': { bin: ['droid'] }, augment: { bin: ['auggie'] },
  tabnine: {}, iflow: { bin: ['iflow'] }, warp: { reg: /^Warp$/, mac: ['Warp'], desk: ['dev.warp.Warp'] }, 'mistral-vibe': { bin: ['vibe'] },
  lmstudio: { reg: /^LM Studio\b/, mac: ['LM Studio'], bin: ['lms'] }, anythingllm: { reg: /^AnythingLLM\b/, mac: ['AnythingLLM'] },
  oterm: { bin: ['oterm'] }, 'muse-code': {}, zcode: {}, 'mcphub-nvim': {}, codebuddy: { bin: ['codebuddy'] }, qoder: { bin: ['qodercli'] },
  cline: {}, kiro: { reg: /^Kiro\b/, mac: ['Kiro'] }, junie: {}, amp: { bin: ['amp'] }, 'kilo-code': { bin: ['kilo'] }, 'amazon-q-cli': { bin: ['q'] },
  openhands: { bin: ['openhands'] }, roo: {}, continue: {}, 'jetbrains-ai': {}, goose: { bin: ['goose'] }, jan: { reg: /^Jan\b/, mac: ['Jan'] },
  'cherry-studio': { reg: /^Cherry Studio\b/, mac: ['Cherry Studio'] }, boltai: { mac: ['BoltAI'] }, lingma: {}, rovodev: {}, crush: { bin: ['crush'] },
  'grok-bot': { reg: /^Grok Bot$/, win: ['lad:Programs/Grok Bot', 'ad:Grok Bot'], mac: ['Grok Bot'], sup: ['Grok Bot'] },
  'microsoft-copilot': { reg: /^Microsoft Copilot$/, msix: ['Microsoft.Copilot_'] },
};

/** The values of one `reg query <hive> /s` listing: one entry per subkey that has any of the four values. */
export function parseReg(text) {
  const out = []; let cur;
  const lines = String(text).split(/\r?\n/);
  for (const line of lines) {
    if (/^HKEY_/.test(line)) { cur = {}; out.push(cur); continue; }
    const m = /^\s+(\S+)\s+REG_\w+\s+(.*)$/.exec(line);
    if (m && cur && VALUES.includes(m[1])) cur[m[1]] = m[2].trim();
  }
  return out.filter((e) => Object.keys(e).length);
}

/** One registry hive through the system reg.exe: absolute path, no shell, a time limit. */
function regQuery(hive) {
  const r = cp.spawnSync(REG_EXE, ['query', hive, '/s'], { shell: false, timeout: REG_TIMEOUT_MS, windowsHide: true, encoding: 'utf8', maxBuffer: 32 << 20 });
  if (r.error?.code === 'ETIMEDOUT') return { entries: [], timedOut: true };
  return { entries: r.status === 0 ? parseReg(r.stdout) : [] };
}

/** The readers discover uses on this computer: the registry, names in a folder, and what kind of thing a path is. */
export const readers = {
  registry: regQuery,
  list: (dir) => { try { return fs.readdirSync(dir); } catch { return []; } },
  // metadata only: { dir, file, real } where real is the path with every link resolved, or null when nothing is there
  stat: (p) => { try { const s = fs.statSync(p); return { dir: s.isDirectory(), file: s.isFile(), real: fs.realpathSync(p) }; } catch { return null; } },
};

/** The folder an icon path is in, from a DisplayIcon value such as "C:\Program Files\App\app.exe",0 */
export const iconFolder = (icon) => (icon ? path.win32.dirname(icon.replace(/,\s*-?\d+$/, '').replace(/^"|"$/g, '')) : '');

/**
 * Every app Memev knows, found or not, with how it was found. platform is the one to look for (a test asks for Windows on
 * any computer); r replaces the readers. Returns { apps, problems }: a registry hive that timed out is a problem, and the
 * folders and PATH are still searched.
 */
export function discover(env = process.env, platform = process.platform, r = readers) {
  const win = platform === 'win32';
  const P = win ? path.win32 : path.posix;
  const d = osDirs(env, platform);
  const home = d.home;
  const roots = { lad: d.localAppData, ad: d.appData };
  const apps = platform === 'darwin' ? [env.MEMEV_SYSTEM_APPS || '/Applications', P.join(home, 'Applications')] : [];
  const desk = platform === 'linux' ? [P.join(home, '.local', 'share', 'applications'), env.MEMEV_SYSTEM_DESKTOP || '/usr/share/applications'] : [];
  const pathDirs = String(env.PATH || env.Path || '').split(win ? ';' : ':').filter(Boolean);
  // the folders a found path may resolve into; anything a link leads outside them, or into an app's data folder, is not used
  const real = (x) => r.stat(x)?.real || x;
  const allowed = [home, roots.lad, roots.ad, ...apps, ...desk, ...pathDirs].map(real);
  const homeReal = real(home);
  const under = (p, dir) => p === dir || p.startsWith(dir + P.sep);
  // an app's data: a dot folder in the home folder, Roaming on Windows, Application Support on macOS
  const inData = (p) => /^\.(?!\.)/.test(P.relative(homeReal, p)) || [roots.ad, P.join(home, 'Library', 'Application Support')].map(real).some((x) => under(p, x));
  const look = (p, want) => {
    const s = r.stat(p);
    // a link counts only when it resolves inside the folders searched, and never into an app's data
    return s?.[want] === true && (s.real === p || (allowed.some((a) => under(s.real, a)) && !inData(s.real)));
  };
  const problems = []; const reg = [];
  if (win) for (const hive of HIVES) { const q = r.registry(hive); if (q.timedOut) problems.push({ hive, problem: 'the registry query timed out' }); reg.push(...q.entries); }
  const packages = win ? r.list(P.join(roots.lad, 'Packages')) : [];
  const desktopFiles = desk.flatMap((x) => r.list(x));
  const supported = new Set(clientDefs(env, 'memev', platform).map((x) => x.id));
  const all = [...clientDefs(env, 'memev', platform), ...unsupportedDefs(env, platform)].filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i);
  const list = all.map((def) => {
    const pr = PROBES[def.id] || {};
    const hit = (evidence, at) => ({ evidence, install_path: at });
    const find = () => {
      if (win) {
        const e = reg.find((x) => pr.reg?.test(x.DisplayName || ''));
        const folders = (pr.win || []).map((w) => P.join(roots[w.slice(0, w.indexOf(':'))], ...w.slice(w.indexOf(':') + 1).split('/')));
        if (e) return hit('registry', e.InstallLocation || iconFolder(e.DisplayIcon) || folders.find((f) => look(f, 'dir')) || null);
        const pkg = packages.find((n) => (pr.msix || []).some((m) => n.startsWith(m)));
        if (pkg) return hit('msix', P.join(roots.lad, 'Packages', pkg));
        const f = folders.find((x) => look(x, 'dir'));
        if (f) return hit('folder', f);
      }
      const b = apps.flatMap((a) => (pr.mac || []).map((m) => P.join(a, `${m}.app`))).find((x) => look(x, 'dir'));
      if (b) return hit('app-bundle', b);
      const s = platform === 'darwin' ? (pr.sup || []).map((m) => P.join(home, 'Library', 'Application Support', m)).find((x) => look(x, 'dir')) : null;
      if (s) return hit('folder', s);
      if ((pr.desk || []).some((n) => desktopFiles.includes(`${n}.desktop`))) return hit('desktop-file', null);
      const exe = pathDirs.flatMap((dir) => (pr.bin || []).flatMap((n) => (win ? [`${n}.exe`, `${n}.cmd`] : [n]).map((x) => P.join(dir, x)))).find((x) => look(x, 'file'));
      if (exe) return hit('path', exe);
      return def.detect() ? hit('config', null) : null;
    };
    const f = find();
    const automation = supported.has(def.id) ? 'auto' : def.step ? 'one-step' : 'none';
    return { id: def.id, name: def.name, found: !!f, evidence: f?.evidence || null, install_path: f?.install_path || null, automation, step: automation === 'one-step' ? def.step : null };
  });
  return { apps: list, problems };
}

const line = (a) => `  ${a.name.padEnd(22)} ${a.automation === 'auto' ? 'Memev connects it' : a.automation === 'one-step' ? 'one step by hand' : 'found, cannot be connected'} (${a.evidence}${a.install_path ? `: ${a.install_path}` : ''})`;

export async function command(cmd, pos, flags, { root, env }) {
  const { config } = await import('./common.mjs');
  const port = env.MEMEV_PORT || config(root).port;
  const res = discover(port ? { ...env, MEMEV_PORT: String(port) } : env, process.platform);
  const found = res.apps.filter((x) => x.found);
  console.log(flags.json ? JSON.stringify({ platform: process.platform, ...res }, null, 2) : found.length ? found.map(line).join('\n') : 'No AI apps found.');
  return 0; // mutate-ignore: main treats a command that returns nothing as exit 0, so this return cannot be told apart
}
