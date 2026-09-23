/**
 * Fuller identity: name, version and verified proverbs.
 *
 * Fuller is named after Thomas Fuller (1654–1734), the English physician who
 * compiled "Gnomologia: Adagies and Proverbs" (1732), the source of almost every
 * aphorism attributed to "Thomas Fuller" — not to be confused with Thomas Fuller
 * (1608–1661), the churchman and historian of "The Worthies of England".
 */
export const APP_NAME = 'Fuller';
export const APP_SLUG = 'fuller';
export const APP_VERSION = '0.3.0';
export const CONFIG_DIR_NAME = '.fuller';
export const MEMORY_FILE = 'FULLER.md';

export interface Proverb {
  text: string;
  source: string;
}

/** Quotes verified against Wikiquote / Gnomologia (see reports/). */
export const PROVERBS: Proverb[] = [
  { text: 'All things are difficult before they are easy.', source: 'Gnomologia, 1732, n°560' },
  { text: 'Seeing is believing, but feeling is the truth.', source: 'Gnomologia, n°4087' },
  { text: 'If thou art a master, be sometimes blind; if a servant, sometimes deaf.', source: 'Gnomologia, n°4071' },
  { text: 'He that plants trees loves others besides himself.', source: 'Gnomologia' },
  { text: 'Be a friend to thyself, and others will be so too.', source: 'Gnomologia' },
  { text: 'In fair weather, prepare for foul.', source: 'Gnomologia' },
  { text: 'Men apt to promise, are apt to forget.', source: 'Gnomologia, n°3387' },
  { text: 'Get the facts, or the facts will get you.', source: 'attribué à Thomas Fuller' },
  { text: 'Good is not good, where better is expected.', source: 'Gnomologia' },
  { text: 'Care and diligence bring luck.', source: 'Gnomologia' },
  { text: 'Zeal without knowledge is fire without light.', source: 'Gnomologia' },
  { text: 'A book that is shut is but a block.', source: 'Gnomologia' },
  { text: 'An invincible determination can accomplish almost anything.', source: 'attribué à Thomas Fuller' },
];

export function proverbOfTheDay(date = new Date()): Proverb {
  const day = Math.floor(date.getTime() / 86_400_000);
  return PROVERBS[day % PROVERBS.length];
}

/** Spinner verbs shown while the model is working (Claude Code style). */
export const SPINNER_VERBS = [
  'Pondering', 'Thinking', 'Musing', 'Reasoning', 'Considering', 'Composing',
  'Weighing', 'Gathering', 'Sifting', 'Compiling', 'Reckoning', 'Deliberating',
  'Contemplating', 'Working', 'Crafting', 'Unfolding', 'Untangling', 'Brewing',
];

export const SPINNER_FRAMES = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];

export const STARTUP_TIPS = [
  'Tapez / pour la liste des commandes, @ pour insérer un fichier, ! pour une commande shell.',
  'Shift+Tab alterne les modes : manual → accept edits → plan → bypass.',
  'Esc interrompt, Esc Esc ouvre le menu de restauration (rewind).',
  'Ctrl+O bascule le transcript détaillé (sorties d\'outils complètes).',
  'Collez plusieurs lignes : elles sont repliées en [Pasted text #N +L lines].',
  'Ajoutez un FULLER.md à la racine du projet pour donner du contexte permanent.',
  '/compact résume la conversation quand le contexte devient volumineux.',
  '/model <nom> change de modèle en conservant l\'historique.',
];
