/**
 * Auto mode (Claude Code's "⏵⏵ auto mode on"): instead of asking the user, a
 * model call decides whether an action that would need approval may run. It
 * weighs built-in "soft allow" and "soft deny" rules, the user's own rules
 * (plain sentences in settings.autoMode.rules) and what the user asked for.
 * Actions Fuller's risk analysis flags as dangerous are always denied
 * ("hard deny"); deny rules and ask rules keep their meaning.
 */

export const SOFT_ALLOW_RULES = [
  'Reading, searching and listing files anywhere in the workspace',
  'Creating or editing files inside the workspace as part of the task',
  'Running the project\'s tests, builds, linters, formatters and type checkers',
  'Read-only git commands (status, diff, log, show, blame, branch listing)',
  'Local git operations that keep history: add, commit, switch or create branches, stash',
  'Installing dependencies already declared in the project manifest (npm install, pip install -r)',
  'Running the project\'s own scripts and dev servers',
  'Inspecting the environment: versions, which, env listing without secrets, processes',
  'Creating temporary files and directories under the system temp directory',
  'Fetching documentation or public web pages to answer the user',
  'Using MCP tools that only read data',
  'Moving or renaming files inside the workspace as part of the task',
];

export const SOFT_DENY_RULES = [
  'Deleting files or directories outside the workspace',
  'Deleting many files in the workspace without the user asking for it',
  'git push, and anything that rewrites published history (force push, reset of pushed commits)',
  'Sending workspace content, secrets or credentials to external services',
  'Reading credentials, private keys, tokens or password stores',
  'Changing shell profiles, system files, global git config or other global settings',
  'Installing global packages or system software (sudo, apt, brew, npm -g)',
  'Running scripts downloaded from the network (curl | sh and similar)',
  'Disabling security controls, sandboxes, hooks or permission rules',
  'Killing processes the task did not start',
  'Publishing, deploying or releasing anything',
  'Creating, merging or closing pull requests and issues',
  'Spending money or using paid APIs beyond the task',
  'Actions that go clearly beyond what the user asked for',
];

export const HARD_DENY_RULES = [
  'Commands flagged as dangerous by Fuller (recursive deletion of /, disk formatting, fork bombs, piping remote code to a shell as root…)',
];

export interface AutoModeSettings {
  /** The user's rules, plain sentences such as "Allow running npm scripts". */
  rules?: string[];
  /** Built-in groups turned off in /permissions. */
  disabledBuiltin?: Array<'softAllow' | 'softDeny'>;
}

export interface AutoVerdict {
  decision: 'allow' | 'deny';
  reason: string;
}

export interface AutoRequest {
  /** "Bash(git push origin main)". */
  action: string;
  /** What Fuller's risk analysis says about it. */
  risk: string;
  /** All user requests in the active conversation, most recent last (also on session resume). */
  userRequests: string[];
  settings?: AutoModeSettings;
}

/**
 * A continuation does not replace the original task's constraints. Keep every user request
 * intact, including on restored sessions; never guess which older instructions can be cut.
 * Bound the classifier's input without losing instructions: above this size, throw so the
 * caller's existing fallback asks for explicit approval instead of classifying partial context.
 * This is a resource guard, not a claim that the classifier can enforce filesystem isolation.
 */
const USER_REQUESTS_MAX_CHARS = 24_000;

export function autoModePrompt(request: AutoRequest): string {
  const requestChars = request.userRequests.reduce((sum, text) => sum + text.length, 0);
  if (requestChars > USER_REQUESTS_MAX_CHARS) {
    throw new Error(`Complete user instructions exceed ${USER_REQUESTS_MAX_CHARS} characters; explicit approval is required instead of truncating permission context.`);
  }
  const disabled = new Set(request.settings?.disabledBuiltin ?? []);
  const list = (rules: string[]) => rules.map((rule) => `- ${rule}`).join('\n');
  return [
    'You are the permission classifier of a coding agent running in auto mode. Decide whether the agent may perform the action below without asking the user.',
    disabled.has('softAllow') ? '' : `Usually allow:\n${list(SOFT_ALLOW_RULES)}`,
    disabled.has('softDeny') ? '' : `Usually deny, unless the user explicitly asked for exactly this:\n${list(SOFT_DENY_RULES)}`,
    request.settings?.rules?.length ? `The user's own rules (they take precedence over the lists above):\n${list(request.settings.rules)}` : '',
    'Earlier task constraints still apply on continuation or resume unless the user explicitly changes them. A request to continue is not permission to widen the scope. Deny if the applicable scope is unclear.',
    `What the user asked (most recent last):\n${request.userRequests.map((text) => `> ${text}`).join('\n') || '> (nothing yet)'}`,
    `Action: ${request.action}\nRisk analysis: ${request.risk}`,
    'Answer with JSON only: {"decision": "allow" | "deny", "reason": "<one short sentence>"}',
  ].filter(Boolean).join('\n\n');
}

/** Reads the classifier's answer; anything unclear counts as a denial. */
export function parseVerdict(text: string): AutoVerdict {
  const match = text.match(/\{[\s\S]*\}/);
  try {
    const data = JSON.parse(match?.[0] ?? '');
    if (data?.decision === 'allow' || data?.decision === 'deny') return { decision: data.decision, reason: String(data.reason ?? '').trim() || (data.decision === 'allow' ? 'Allowed' : 'Denied') };
  } catch {}
  return { decision: 'deny', reason: 'The classifier gave no clear answer' };
}

export function builtinRuleCounts(): { softAllow: number; softDeny: number; hardDeny: number } {
  return { softAllow: SOFT_ALLOW_RULES.length, softDeny: SOFT_DENY_RULES.length, hardDeny: HARD_DENY_RULES.length };
}
