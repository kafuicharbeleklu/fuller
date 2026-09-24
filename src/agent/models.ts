import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { GoogleGenAI } from '@google/genai';
import { CONFIG_DIR_NAME } from '../branding.js';

export interface ModelInfo {
  /** Short id usable with -m / /model, e.g. "gemini-3.8-flash". */
  id: string;
  displayName: string;
  description?: string;
  inputTokenLimit: number;
  outputTokenLimit: number;
  actions: string[];
}

const CACHE_FILE = path.join(os.homedir(), CONFIG_DIR_NAME, 'models.json');
const CACHE_TTL = 6 * 3600 * 1000;

/**
 * Free-tier availability is not exposed by ListModels; this list comes from the official
 * pricing page (https://ai.google.dev/gemini-api/docs/pricing), checked on FREE_TIER_VERIFIED.
 */
export const FREE_TIER_VERIFIED = '2026-09-22';
export const FREE_TIER_MODELS = new Set([
  'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
]);
export const NO_FREE_TIER_MODELS = new Set(['gemini-3.1-pro-preview', 'gemini-3.1-pro-preview-customtools', 'gemini-2.5-computer-use-preview-10-2025']);
/** "Recent" = this generation or newer. */
export const RECENT_MIN_VERSION = 3.5;

export type FreeTierStatus = 'free' | 'paid' | 'unknown';

export function freeTierStatus(id: string): FreeTierStatus {
  if (FREE_TIER_MODELS.has(id)) return 'free';
  if (NO_FREE_TIER_MODELS.has(id)) return 'paid';
  return 'unknown';
}

export function modelVersion(id: string): number {
  const m = id.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

/** Recent and free of charge: what the picker shows by default. */
export function isRecommendedModel(m: ModelInfo): boolean {
  // Gemma 4 (open models, served by the Gemini API) is offered too: a light fallback when Flash is busy.
  if (isChatModel(m) && /^gemma-4-/.test(m.id)) return true;
  return isChatModel(m) && freeTierStatus(m.id) === 'free' && modelVersion(m.id) >= RECENT_MIN_VERSION && !/preview|customtools/.test(m.id);
}

const NON_CHAT = /image|banana|tts|audio|live|embedding|embed|veo|lyria|robotics|transcribe|translate|computer-use|deep-research|antigravity|aqa|omni|realtime|imagen/i;

/** Text/code models usable by the agent (generateContent, not media/audio/embedding specialised). */
export function isChatModel(m: ModelInfo): boolean {
  if (!m.actions.includes('generateContent')) return false;
  if (NON_CHAT.test(m.id) || NON_CHAT.test(m.displayName)) return false;
  return /^(gemini|gemma)/i.test(m.id);
}

function readCache(): { at: number; models: ModelInfo[] } | null {
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (Array.isArray(data?.models) && typeof data.at === 'number') return data;
  } catch {}
  return null;
}

export async function listModels(apiKey: string, options: { force?: boolean; signal?: AbortSignal } = {}): Promise<ModelInfo[]> {
  const cached = readCache();
  if (!options.force && cached && Date.now() - cached.at < CACHE_TTL) return cached.models;
  const ai = new GoogleGenAI({ apiKey });
  const pager = await ai.models.list({ config: { pageSize: 100, abortSignal: options.signal } });
  const models: ModelInfo[] = [];
  for await (const m of pager) {
    if (!m.name) continue;
    models.push({
      id: m.name.replace(/^models\//, ''),
      displayName: m.displayName ?? m.name,
      description: m.description,
      inputTokenLimit: m.inputTokenLimit ?? 0,
      outputTokenLimit: m.outputTokenLimit ?? 0,
      actions: m.supportedActions ?? [],
    });
  }
  models.sort((a, b) => a.id.localeCompare(b.id));
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ at: Date.now(), models }), 'utf8');
  } catch {}
  return models;
}

export async function listChatModels(apiKey: string, options: { force?: boolean; signal?: AbortSignal; all?: boolean } = {}): Promise<ModelInfo[]> {
  const all = await listModels(apiKey, options);
  const chat = all.filter(options.all ? isChatModel : isRecommendedModel);
  // Newest generations first.
  return chat.sort((a, b) => modelVersion(b.id) - modelVersion(a.id) || a.id.localeCompare(b.id));
}

/** Context window hint for a model id (cache only, no network). */
/**
 * Models tried in turn when the current one is out of quota on every key or overloaded:
 * the user's model first, then the free Gemini models from the newest, then Gemma 4.
 */
export const DEFAULT_MODEL_CHAIN = [
  'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite',
  'gemma-4-31b-it', 'gemma-4-26b-a4b-it',
];

/** The chain for a preferred model: settings.fallbackModels, the older single fallbackModel, or the default; "off" keeps one model. */
export function modelChain(preferred: string, settings: { fallbackModels?: string[] | 'off'; fallbackModel?: string }): string[] {
  if (settings.fallbackModels === 'off' || settings.fallbackModel === 'off') return [preferred];
  const rest = Array.isArray(settings.fallbackModels) ? settings.fallbackModels
    : settings.fallbackModel ? [settings.fallbackModel]
    : DEFAULT_MODEL_CHAIN;
  return [...new Set([preferred, ...rest])];
}

/** Input window of a model: from the model list when cached, else the documented size. */
export function contextWindowOf(modelId: string): number {
  return knownContextWindow(modelId) ?? (/^gemma-4-/.test(modelId) ? 262_144 : 1_048_576);
}

export function knownContextWindow(modelId: string): number | undefined {
  const cached = readCache();
  return cached?.models.find((m) => m.id === modelId)?.inputTokenLimit || undefined;
}

export function formatModelTable(models: ModelInfo[]): string {
  const width = Math.max(...models.map((m) => m.id.length), 10);
  const label = { free: 'free', paid: 'paid', unknown: 'free?' } as const;
  return models
    .map((m) => `${m.id.padEnd(width)}  ${String(m.inputTokenLimit ? Math.round(m.inputTokenLimit / 1024) + 'k' : '?').padStart(6)} ctx  ${label[freeTierStatus(m.id)].padEnd(5)}  ${m.displayName}`)
    .join('\n');
}
