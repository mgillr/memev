// Fixtures for the scope verifier tests (SR-0.03 task 2): a git repository whose first commit is the base, a contract of named
// tasks signed against it, and the scope criterion's result for each task.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir, OWNER } from './tmp.mjs';
export { OWNER };

const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false'];
/** git in `dir` with a fixed identity and no signing; returns trimmed stdout. */
export const gitIn = (dir, ...args) => execFileSync('git', ['-C', dir, ...ID, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export const SCOPE_CRITERION = { statement: 'changes stay in scope', verifier: { type: 'scope' } };

/** Write `files` ({ path: text, or null to delete }) in `dir` without committing. */
export function put(dir, files) {
  for (const [p, t] of Object.entries(files)) {
    const f = path.join(dir, p);
    if (t === null) fs.rmSync(f, { force: true, recursive: true });
    else { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); }
  }
}
/** Write `files` in `dir` and commit them with `message`; returns the new HEAD. */
export function commitFiles(dir, files, message = 'change') {
  put(dir, files);
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '--allow-empty', '-m', message);
  return gitIn(dir, 'rev-parse', 'HEAD');
}
/** A new repository (on branch main) whose first commit holds `files`; returns { dir, base }. */
export function repoAt(files = { 'README.md': 'start\n' }, prefix = 'scope-repo-') {
  const dir = fs.realpathSync(tmpdir(prefix));
  gitIn(dir, 'init', '-q', '-b', 'main');
  return { dir, base: commitFiles(dir, files, 'start') };
}
/** The trailer a commit carries to name its task. */
export const trailer = (id, task) => `\n\nContract-Task: ${id} ${task}`;

/**
 * Draft and sign (locally unless `local` is false) a contract of `tasks` ({ T1: ['a.js'], T2: ['b.js'] }), each with one scope
 * criterion, against `base` (the workdir's HEAD when omitted). Returns its id.
 */
export function signScope(v, { workdir, base, tasks, local = true, extra = [] }) {
  const list = Object.entries(tasks).map(([id, scope]) => ({ id, title: `task ${id}`, scope, criteria: [SCOPE_CRITERION, ...extra] }));
  const d = v.contractDraft(OWNER, { title: 'Scope fixture', workdir, ...(base ? { base } : {}), tasks: list });
  v.contractSign(OWNER, { id: d.id, local });
  return d.id;
}
/** The scope criterion's result of each task in a verify result: { T1: { status, detail }, ... }. */
export const scopeResults = (r) => Object.fromEntries(r.tasks.map((t) => [t.id, t.criteria.find((c) => c.statement === SCOPE_CRITERION.statement)]));
/** Sign a contract and verify it once; returns the scope results by task. */
export async function verifyScope(v, opts, call = {}) {
  const id = signScope(v, opts);
  return scopeResults(await v.contractVerify(OWNER, { id }, call));
}

/**
 * Plant in the git repository at `dir` what a hostile repository could use to run code while git inspects it: a core.fsmonitor
 * script, a clean filter named in .gitattributes and configured in .git/config, and a post-checkout hook. Each writes its own
 * marker file in `markers`; call it after the fixture's own commits, which it would otherwise trigger. Returns the marker paths,
 * with `gen` the one a docs generator written by generatorText() writes.
 */
export function plant(dir, markers = tmpdir('scope-markers-')) {
  const m = { fsm: path.join(markers, 'marker-fsm'), filter: path.join(markers, 'marker-filter'), hook: path.join(markers, 'marker-hook'), gen: path.join(markers, 'marker-gen') };
  const script = (name, marker, body = '') => { const f = path.join(markers, name); fs.writeFileSync(f, `#!/bin/sh\necho ran >> '${marker}'\n${body}\n`, { mode: 0o755 }); return f; };
  gitIn(dir, 'config', 'core.fsmonitor', script('fsmonitor.sh', m.fsm));
  gitIn(dir, 'config', 'filter.plant.clean', script('clean.sh', m.filter, 'cat'));
  gitIn(dir, 'config', 'filter.plant.required', 'false');
  fs.appendFileSync(path.join(dir, '.gitattributes'), '*.js filter=plant\n*.md filter=plant\n');
  fs.mkdirSync(path.join(dir, '.git', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git', 'hooks', 'post-checkout'), `#!/bin/sh\necho ran >> '${m.hook}'\n`, { mode: 0o755 });
  return m;
}
/** A scripts/docs/module-graph.mjs that writes docs/MODULES.md (`text`) and, when `marker` is given, leaves a line in that file. */
export const generatorText = (text = 'generated\n', marker = null) => `import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
${marker ? `fs.appendFileSync(${JSON.stringify(marker)}, 'ran\\n');\n` : ''}fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'MODULES.md'), ${JSON.stringify(text)});
`;
/** The marker files that exist. */
export const ran = (markers) => Object.entries(markers).filter(([, f]) => fs.existsSync(f)).map(([k]) => k);
