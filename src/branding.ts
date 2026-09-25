/**
 * Fuller identity: name and version.
 *
 * Fuller is named after Thomas Fuller (c. 1710–1790), "the Virginia
 * Calculator": born in Africa, enslaved in Virginia from 1724, and renowned for
 * extraordinary mental arithmetic, such as counting the seconds a man had lived,
 * leap years included, in about a minute and a half, though he never learned
 * to read or write.
 */
export const APP_NAME = 'Fuller';
export const APP_SLUG = 'fuller';
export const APP_VERSION = '0.3.0';
export const CONFIG_DIR_NAME = '.fuller';
export const MEMORY_FILE = 'FULLER.md';


/** Spinner verbs shown while the model is working (Claude Code style). */
export const SPINNER_VERBS = [
  'Pondering', 'Thinking', 'Musing', 'Reasoning', 'Considering', 'Composing',
  'Weighing', 'Gathering', 'Sifting', 'Compiling', 'Reckoning', 'Deliberating',
  'Contemplating', 'Working', 'Crafting', 'Unfolding', 'Untangling', 'Brewing',
];

/** Claude Code 2.1.281 spinner glyphs, played forth and back. */
export const SPINNER_FRAMES = ['·', '✢', '*', '✶', '✻', '✽', '✻', '✶', '*', '✢'];

/** Verbs of the end-of-turn line, as in Claude Code ("✻ Churned for 14s · done 3:20 AM"). */
export const SPINNER_PAST_VERBS = ['Baked', 'Brewed', 'Churned', 'Cooked', 'Crunched', 'Mulled', 'Pondered', 'Simmered', 'Worked'];

/** Startup tips, shown under the banner on some launches only, like Claude Code's notices. */
export const STARTUP_TIPS = [
  'Type / for commands, @ to mention a file, ! to run a shell command.',
  'Shift+Tab cycles modes: manual → accept edits → plan → auto.',
  'Esc interrupts; Esc Esc opens the rewind menu.',
  'Ctrl+O toggles the detailed transcript with full tool output.',
  'Pasted text longer than a few lines is collapsed into [Pasted text #N +L lines].',
  'Add a FULLER.md at the project root to give Fuller lasting context.',
  '/compact summarizes the conversation when the context grows large.',
  '/model <name> switches models and keeps the conversation.',
];

/** Share of launches that show a startup tip. */
export const STARTUP_TIP_CHANCE = 1 / 3;
