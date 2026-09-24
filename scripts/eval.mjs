#!/usr/bin/env node
/**
 * Fuller's benchmark: run the agent on the tasks in evals/tasks and check the result.
 *
 *   node scripts/eval.mjs [--model gemini-3.6-flash] [--only name,name] [--repeat N] [--compare evals/results/<file>.json]
 *   node scripts/eval.mjs --baseline      # checks only, no agent: every task must fail
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
const TASKS = path.join(ROOT, 'evals', 'tasks');
const RESULTS = path.join(ROOT, 'evals', 'results');
const ALLOWED = ['Bash(node:*)', 'Bash(npm test:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(grep:*)', 'Bash(git diff:*)', 'Bash(git status:*)'];

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const baseline = args.includes('--baseline');
const model = option('--model', process.env.GEMINI_MODEL || 'gemini-3.6-flash');
const only = option('--only', '')?.split(',').filter(Boolean) ?? [];
const repeat = Math.max(1, Number(option('--repeat', '1')) || 1);
const compareFile = option('--compare', '');

function loadEnvKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  try {
    const line = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n').find((l) => l.startsWith('GEMINI_API_KEY='));
    return line?.slice('GEMINI_API_KEY='.length).replace(/^["']|["']$/g, '').trim();
  } catch { return undefined; }
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

function runAgent(task, dirs, key) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('node', [path.join(ROOT, 'dist', 'index.js'), '-p', task.prompt, '--output-format', 'json', '--model', model,
      '--permission-mode', 'acceptEdits', '--allowedTools', ...ALLOWED], {
      cwd: dirs.repo,
      env: { ...process.env, HOME: dirs.home, GEMINI_API_KEY: key, GEMINI_MODEL: model },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGTERM'), (task.timeoutSec ?? 240) * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      let result = null;
      try { result = JSON.parse(stdout.trim().split('\n').pop() ?? ''); } catch {}
      resolve({ code, result, stderr, durationMs: Date.now() - started });
    });
  });
}

function check(task, dirs) {
  const res = spawnSync('sh', ['-c', task.check], { cwd: dirs.repo, env: { ...process.env, EVAL_ANSWER: dirs.answer }, encoding: 'utf8', timeout: 120_000 });
  return { pass: res.status === 0, output: `${res.stdout ?? ''}${res.stderr ?? ''}`.slice(-2000) };
}

const names = fs.readdirSync(TASKS).filter((n) => fs.existsSync(path.join(TASKS, n, 'task.json'))).filter((n) => !only.length || only.includes(n)).sort();
if (!names.length) { console.error('No tasks.'); process.exit(2); }
const key = baseline ? '' : loadEnvKey();
if (!baseline && !key) { console.error('GEMINI_API_KEY is required (environment or .env).'); process.exit(2); }
if (!baseline && !fs.existsSync(path.join(ROOT, 'dist', 'index.js'))) { console.error('Build first: npm run build'); process.exit(2); }

const rows = [];
for (const name of names) {
  const task = JSON.parse(fs.readFileSync(path.join(TASKS, name, 'task.json'), 'utf8'));
  for (let run = 1; run <= repeat; run++) {
    const dirs = prepare(path.join(TASKS, name));
    let agent = { code: 0, result: null, stderr: '', durationMs: 0 };
    if (!baseline) {
      process.stdout.write(`${name}${repeat > 1 ? ` #${run}` : ''} … `);
      agent = await runAgent(task, dirs, key);
      fs.writeFileSync(dirs.answer, agent.result?.result ?? '');
    } else {
      fs.writeFileSync(dirs.answer, '');
    }
    const verdict = check(task, dirs);
    // An API failure (quota, overload) says nothing about the agent: count it apart.
    const apiError = !baseline && !verdict.pass && (agent.result?.is_error || (!agent.result && agent.code !== 0)) && /quota|rate.?limit|429|503|overloaded|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(`${agent.result?.result ?? ''}${agent.stderr}`);
    const row = {
      task: name, run, pass: verdict.pass, status: verdict.pass ? 'pass' : apiError ? 'api-error' : 'fail',
      durationMs: agent.durationMs,
      tokens: agent.result?.usage?.total_tokens ?? null,
      toolCalls: agent.result?.num_tool_calls ?? null,
      agentError: agent.result?.is_error ? String(agent.result?.result ?? '').slice(0, 300) : agent.code && !agent.result ? agent.stderr.slice(-300) : undefined,
      checkOutput: verdict.pass ? undefined : verdict.output,
    };
    rows.push(row);
    if (baseline) console.log(`${name}: ${verdict.pass ? 'PASSES WITHOUT THE AGENT (task is too easy or broken)' : 'fails as expected'}`);
    else console.log(`${row.status === 'pass' ? 'PASS' : row.status === 'api-error' ? 'API ERROR' : 'FAIL'} · ${(row.durationMs / 1000).toFixed(0)}s · ${row.tokens ?? '?'} tokens · ${row.toolCalls ?? '?'} tools${row.agentError ? ` · ${row.agentError.split('\n')[0]}` : ''}`);
    fs.rmSync(dirs.work, { recursive: true, force: true });
  }
}

if (baseline) process.exit(rows.some((r) => r.pass) ? 1 : 0);

const passed = rows.filter((r) => r.status === 'pass').length;
const scored = rows.filter((r) => r.status !== 'api-error');
const apiErrors = rows.length - scored.length;
const total = (key) => scored.reduce((s, r) => s + (r[key] ?? 0), 0);
const summary = { model, date: new Date().toISOString(), passed, runs: scored.length, apiErrors, rate: scored.length ? passed / scored.length : 0, tokens: total('tokens'), durationMs: total('durationMs'), toolCalls: total('toolCalls') };
console.log(`\n${passed}/${scored.length} passed (${Math.round(summary.rate * 100)} %) · ${summary.tokens} tokens · ${(summary.durationMs / 1000).toFixed(0)}s · ${summary.toolCalls} tool calls${apiErrors ? ` · ${apiErrors} not scored (API errors: quota or overload)` : ''}`);
fs.mkdirSync(RESULTS, { recursive: true });
const out = path.join(RESULTS, `${summary.date.slice(0, 16).replace(/[:T]/g, '-')}-${model}.json`);
fs.writeFileSync(out, JSON.stringify({ summary, rows }, null, 2) + '\n');
console.log(`Results: ${path.relative(ROOT, out)}`);

if (compareFile) {
  const before = JSON.parse(fs.readFileSync(path.resolve(compareFile), 'utf8'));
  const delta = (a, b) => (b - a >= 0 ? '+' : '') + (b - a);
  console.log(`\nCompared with ${path.basename(compareFile)} (${before.summary.model}):`);
  console.log(`  passed ${before.summary.passed}/${before.summary.runs} → ${passed}/${rows.length} · tokens ${delta(before.summary.tokens, summary.tokens)} · tool calls ${delta(before.summary.toolCalls, summary.toolCalls)}`);
  for (const r of rows) {
    const b = before.rows.find((x) => x.task === r.task && x.run === r.run);
    if (b && b.pass !== r.pass) console.log(`  ${r.task}: ${b.pass ? 'PASS → FAIL' : 'FAIL → PASS'}`);
  }
}
