#!/usr/bin/env node
/**
 * Fuller's benchmark: run the agent on the tasks in evals/tasks and check the result.
 *
 *   node scripts/eval.mjs [--model gemini-3.6-flash] [--only name,name] [--repeat N] [--compare evals/results/<file>.json]
 *   node scripts/eval.mjs --baseline          # checks only, no agent: every task must fail
 *   node scripts/eval.mjs --verify-solutions  # each task's solution.patch applied: every task must pass
 *
 * task.json may list "protect" (paths put back to their original version before the check, so the
 * agent cannot pass by editing the tests that judge it) and "mustNotChange" (paths the agent must not
 * modify at all: doing so fails the task). Failed runs keep a trace in evals/results/traces/.
 *
 * Each task is a folder with task.json ({ prompt, check, timeoutSec }) and repo/ (the starting project).
 * The repo is copied to a temporary git repository; Fuller runs headless there (-p, JSON output) with
 * accept-edits and a few read-only or test commands allowed, under a private HOME (no user memory or
 * settings). Then `check` runs in the repo (exit 0 = pass); $EVAL_ANSWER holds the agent's final answer.
 * Results go to evals/results/<date>-<model>.json. Needs GEMINI_API_KEY (from the environment or .env).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// EVAL_TASKS_DIR points to another task folder (used by the runner's own tests).
const TASKS = process.env.EVAL_TASKS_DIR ? path.resolve(process.env.EVAL_TASKS_DIR) : path.join(ROOT, 'evals', 'tasks');
const RESULTS = path.join(ROOT, 'evals', 'results');
const ALLOWED = ['Bash(node:*)', 'Bash(npm test:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(grep:*)', 'Bash(git diff:*)', 'Bash(git status:*)'];

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const baseline = args.includes('--baseline');
const verifySolutions = args.includes('--verify-solutions');
const noAgent = baseline || verifySolutions;
const model = option('--model', process.env.GEMINI_MODEL || 'gemini-3.6-flash');
const only = option('--only', '')?.split(',').filter(Boolean) ?? [];
const repeat = Math.max(1, Number(option('--repeat', '1')) || 1);
const compareFile = option('--compare', '');

/** GEMINI_API_KEY and GEMINI_API_KEYS from the environment, the project .env or ~/.fuller/.env. */
function loadKeys() {
  const read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };
  const files = [path.join(ROOT, '.env'), path.join(os.homedir(), '.fuller', '.env')].map(read).join('\n');
  const pick = (name) => process.env[name] || files.split('\n').find((l) => l.startsWith(`${name}=`))?.slice(name.length + 1).replace(/^["']|["']$/g, '').trim();
  return { key: pick('GEMINI_API_KEY'), keys: pick('GEMINI_API_KEYS') };
}

function prepare(taskDir) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-eval-'));
  const repo = path.join(work, 'repo');
  fs.cpSync(path.join(taskDir, 'repo'), repo, { recursive: true });
  const git = (...a) => spawnSync('git', ['-c', 'user.email=eval@fuller', '-c', 'user.name=eval', ...a], { cwd: repo });
  git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'start');
  const home = path.join(work, 'home');
  fs.mkdirSync(path.join(home, '.fuller'), { recursive: true });
  // No model reply after `!` (unused here) and the default permission rules only.
  fs.writeFileSync(path.join(home, '.fuller', 'settings.json'), JSON.stringify({ notifications: 'off' }));
  return { work, repo, home, answer: path.join(work, 'answer.txt') };
}

function runAgent(task, dirs, key, keys) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('node', [path.join(ROOT, 'dist', 'index.js'), '-p', task.prompt, '--output-format', 'json', '--model', model,
      '--permission-mode', 'acceptEdits', '--allowedTools', ...ALLOWED], {
      cwd: dirs.repo,
      env: { ...process.env, HOME: dirs.home, GEMINI_API_KEY: key, ...(keys ? { GEMINI_API_KEYS: keys } : {}), GEMINI_MODEL: model },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGTERM'), (task.timeoutSec ?? 240) * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      let result = null;
      // -p --output-format json prints one pretty-printed object (several lines).
      try { result = JSON.parse(stdout.trim()); } catch { try { result = JSON.parse(stdout.trim().split('\n').pop() ?? ''); } catch {} }
      resolve({ code, result, stderr, durationMs: Date.now() - started });
    });
  });
}

const git = (repo, ...a) => spawnSync('git', ['-c', 'user.email=eval@fuller', '-c', 'user.name=eval', ...a], { cwd: repo, encoding: 'utf8' });

function check(task, dirs) {
  // Paths the agent must not modify at all (the tests of a bug fix, a frozen folder…).
  const forbidden = (task.mustNotChange ?? []).filter((p) => fs.existsSync(path.join(dirs.repo, p)) || git(dirs.repo, 'ls-files', p).stdout.trim());
  // Changed files and new ones (git diff does not list untracked files).
  const touched = forbidden.length ? [
    git(dirs.repo, 'diff', '--name-only', 'HEAD', '--', ...forbidden).stdout.trim(),
    git(dirs.repo, 'ls-files', '--others', '--exclude-standard', '--', ...forbidden).stdout.trim(),
  ].filter(Boolean).join('\n') : '';
  // Put the judging files back to their original version: passing must not come from editing them.
  const protect = (task.protect ?? []).filter((p) => git(dirs.repo, 'ls-files', p).stdout.trim());
  if (protect.length) git(dirs.repo, 'checkout', 'HEAD', '--', ...protect);
  const res = spawnSync('sh', ['-c', task.check], { cwd: dirs.repo, env: { ...process.env, EVAL_ANSWER: dirs.answer }, encoding: 'utf8', timeout: 120_000 });
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`.slice(-2000);
  if (touched) return { pass: false, output: `Modified protected files: ${touched.split('\n').join(', ')}\n${output}` };
  return { pass: res.status === 0, output };
}

/** Keys never go into traces. */
const scrub = (text) => String(text ?? '').replace(/AIza[0-9A-Za-z_-]{20,}|AQ\.[A-Za-z0-9_.-]{20,}/g, '<key>');

function saveTrace(runId, name, run, task, dirs, agent, verdict) {
  const dir = path.join(RESULTS, 'traces', runId);
  fs.mkdirSync(dir, { recursive: true });
  const diff = git(dirs.repo, 'diff', 'HEAD').stdout ?? '';
  const body = [
    `# ${name} (run ${run}) — ${verdict.pass ? 'passed' : 'failed'}`, '', `## Prompt`, task.prompt, '', '## Check', '```', task.check, '```', '', '## Check output', '```', scrub(verdict.output), '```',
    '', '## Final answer', scrub(agent.result?.result ?? '(none)'), '', '## Changes', '```diff', scrub(diff.slice(0, 20_000)), '```', '', '## Agent stderr (end)', '```', scrub(agent.stderr.slice(-4000)), '```',
  ].join('\n');
  fs.writeFileSync(path.join(dir, `${name}-${run}.md`), body);
}

const names = fs.readdirSync(TASKS).filter((n) => fs.existsSync(path.join(TASKS, n, 'task.json'))).filter((n) => !only.length || only.includes(n)).sort();
if (!names.length) { console.error('No tasks.'); process.exit(2); }
const { key, keys } = noAgent ? { key: '', keys: '' } : loadKeys();
if (!noAgent && !key) { console.error('GEMINI_API_KEY is required (environment or .env).'); process.exit(2); }
if (!noAgent && !fs.existsSync(path.join(ROOT, 'dist', 'index.js'))) { console.error('Build first: npm run build'); process.exit(2); }

const rows = [];
const runId = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + `-${model}`;
for (const name of names) {
  const task = JSON.parse(fs.readFileSync(path.join(TASKS, name, 'task.json'), 'utf8'));
  for (let run = 1; run <= repeat; run++) {
    const dirs = prepare(path.join(TASKS, name));
    let agent = { code: 0, result: null, stderr: '', durationMs: 0 };
    if (verifySolutions) {
      const patch = path.join(TASKS, name, 'solution.patch');
      // An analysis task has nothing to change: an empty patch is fine.
      const applied = !fs.existsSync(patch) ? { status: 1, stderr: 'no solution.patch' } : fs.statSync(patch).size === 0 ? { status: 0 } : git(dirs.repo, 'apply', patch);
      if (applied.status !== 0) console.log(`${name}: solution.patch does not apply (${String(applied.stderr).trim()})`);
      fs.writeFileSync(dirs.answer, task.referenceAnswer ?? '');
    } else if (!baseline) {
      process.stdout.write(`${name}${repeat > 1 ? ` #${run}` : ''} … `);
      agent = await runAgent(task, dirs, key, keys);
      fs.writeFileSync(dirs.answer, agent.result?.result ?? '');
    } else if (baseline) {
      fs.writeFileSync(dirs.answer, '');
    }
    const verdict = check(task, dirs);
    // An API failure (quota, overload) says nothing about the agent: count it apart.
    const apiError = !baseline && !verdict.pass && (agent.result?.is_error || (!agent.result && agent.code !== 0)) && /quota|usage limit|rate.?limit|429|503|overloaded|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(`${agent.result?.result ?? ''}${agent.stderr}`);
    const row = {
      task: name, run, pass: verdict.pass, status: verdict.pass ? 'pass' : apiError ? 'api-error' : 'fail',
      durationMs: agent.durationMs,
      tokens: agent.result?.usage?.total_tokens ?? null,
      promptTokens: agent.result?.usage?.prompt_tokens ?? null,
      cachedTokens: agent.result?.usage?.cached_tokens ?? null,
      toolCalls: agent.result?.num_tool_calls ?? null,
      agentError: scrub(agent.result?.is_error ? String(agent.result?.error || agent.result?.result || '').slice(0, 300) : agent.code && !agent.result ? agent.stderr.slice(-300) : '') || undefined,
      // What Fuller asked of the model before it concluded (checks, task list, review, no progress).
      checks: agent.stderr.split('\n').filter((l) => /^(↺|✓ Review|⚠ Stopped|Review skipped)/.test(l)),
      checkOutput: verdict.pass ? undefined : scrub(verdict.output),
      // The model that actually answered (a fallback could differ from the one requested).
      modelUsed: agent.result?.model,
    };
    rows.push(row);
    if (!noAgent && row.status !== 'pass') saveTrace(runId, name, run, task, dirs, agent, verdict);
    if (baseline) console.log(`${name}: ${verdict.pass ? 'PASSES WITHOUT THE AGENT (task is too easy or broken)' : 'fails as expected'}`);
    else if (verifySolutions) console.log(`${name}: ${verdict.pass ? 'reference solution passes' : `REFERENCE SOLUTION FAILS — ${verdict.output.split('\n')[0]}`}`);
    else console.log(`${row.status === 'pass' ? 'PASS' : row.status === 'api-error' ? 'API ERROR' : 'FAIL'} · ${(row.durationMs / 1000).toFixed(0)}s · ${row.tokens ?? '?'} tokens · ${row.toolCalls ?? '?'} tools${row.agentError ? ` · ${row.agentError.split('\n')[0]}` : ''}`);
    fs.rmSync(dirs.work, { recursive: true, force: true });
  }
}

if (baseline) process.exit(rows.some((r) => r.pass) ? 1 : 0);
if (verifySolutions) process.exit(rows.every((r) => r.pass) ? 0 : 1);

const passed = rows.filter((r) => r.status === 'pass').length;
const scored = rows.filter((r) => r.status !== 'api-error');
const apiErrors = rows.length - scored.length;
const total = (key) => scored.reduce((s, r) => s + (r[key] ?? 0), 0);
const summary = { model, date: new Date().toISOString(), passed, runs: scored.length, apiErrors, rate: scored.length ? passed / scored.length : 0, tokens: total('tokens'), promptTokens: total('promptTokens'), cachedTokens: total('cachedTokens'), durationMs: total('durationMs'), toolCalls: total('toolCalls') };
if (repeat > 1) {
  // Regularity: a task that passes 3 times out of 3 is not the same as 1 out of 3.
  for (const name of names) {
    const mine = rows.filter((r) => r.task === name && r.status !== 'api-error');
    if (mine.length) console.log(`  ${name}: ${mine.filter((r) => r.status === 'pass').length}/${mine.length}`);
  }
}
const otherModels = [...new Set(rows.map((r) => r.modelUsed).filter((m) => m && m !== model))];
if (otherModels.length) console.log(`Warning: some runs were answered by ${otherModels.join(', ')}, not ${model}.`);
console.log(`\n${passed}/${scored.length} passed (${Math.round(summary.rate * 100)} %) · ${summary.tokens} tokens${summary.promptTokens ? ` (cache ${Math.round(100 * summary.cachedTokens / summary.promptTokens)} % of prompt)` : ''} · ${(summary.durationMs / 1000).toFixed(0)}s · ${summary.toolCalls} tool calls${apiErrors ? ` · ${apiErrors} not scored (API errors: quota or overload)` : ''}`);
fs.mkdirSync(RESULTS, { recursive: true });
// Same name as the traces folder of this run.
const out = path.join(RESULTS, `${runId}.json`);
fs.writeFileSync(out, JSON.stringify({ summary, rows }, null, 2) + '\n');
console.log(`Results: ${path.relative(ROOT, out)}`);

if (compareFile) {
  const before = JSON.parse(fs.readFileSync(path.resolve(compareFile), 'utf8'));
  const delta = (a, b) => (b - a >= 0 ? '+' : '') + (b - a);
  console.log(`\nCompared with ${path.basename(compareFile)} (${before.summary.model}):`);
  // Only the runs scored in both passages: an API error on one side would skew the totals.
  const pairs = scored.map((r) => [before.rows.find((x) => x.task === r.task && x.run === r.run && x.status !== 'api-error'), r]).filter(([b]) => b);
  const sum = (list, key) => list.reduce((t, r) => t + (r[key] ?? 0), 0);
  const olds = pairs.map(([b]) => b);
  const news = pairs.map(([, r]) => r);
  console.log(`  on the ${pairs.length} run${pairs.length === 1 ? '' : 's'} scored in both: passed ${olds.filter((r) => r.pass).length} → ${news.filter((r) => r.pass).length} · tokens ${delta(sum(olds, 'tokens'), sum(news, 'tokens'))} · tool calls ${delta(sum(olds, 'toolCalls'), sum(news, 'toolCalls'))} · time ${delta(Math.round(sum(olds, 'durationMs') / 1000), Math.round(sum(news, 'durationMs') / 1000))}s`);
  const left = rows.filter((r) => !pairs.some(([, n]) => n === r)).map((r) => r.task);
  if (left.length) console.log(`  not compared (API error on one side): ${[...new Set(left)].join(', ')}`);
  for (const r of rows) {
    const b = before.rows.find((x) => x.task === r.task && x.run === r.run);
    if (b && b.pass !== r.pass) console.log(`  ${r.task}: ${b.pass ? 'PASS → FAIL' : 'FAIL → PASS'}`);
  }
}
