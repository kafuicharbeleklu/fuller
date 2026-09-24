/** Generate Content API levels supported by the text models in Fuller's picker. */
export type ThinkingLevelSetting = 'minimal' | 'low' | 'medium' | 'high';

const STANDARD: ThinkingLevelSetting[] = ['low', 'medium', 'high'];
const WITH_MINIMAL: ThinkingLevelSetting[] = ['minimal', ...STANDARD];

export function supportedThinkingLevels(model: string): ThinkingLevelSetting[] {
  if (/^gemini-3\.(8|7)-flash$/.test(model)) return STANDARD;
  if (/^gemini-3\.(6|5)-flash$/.test(model)) return WITH_MINIMAL;
  if (/^gemini-3\.(5|1)-flash-lite$/.test(model)) return WITH_MINIMAL;
  if (model === 'gemini-3.1-pro-preview') return STANDARD;
  if (model === 'gemini-3-flash-preview') return WITH_MINIMAL;
  if (model === 'gemini-3-pro-preview') return ['low', 'high'];
  // Gemma 4 on the Gemini API: only minimal and high (low is refused with a 400).
  if (/^gemma-4-/.test(model)) return ['minimal', 'high'];
  return [];
}

export function defaultThinkingLevel(model: string): ThinkingLevelSetting | undefined {
  if (/^gemini-3\.(8|7|6|5)-flash$/.test(model)) return 'medium';
  if (/^gemini-3\.(5|1)-flash-lite$/.test(model)) return 'minimal';
  if (/^gemini-3(?:\.1)?-pro-preview$/.test(model) || model === 'gemini-3-flash-preview') return 'high';
  // Gemma 4 thinks by default: high is what it does without a setting.
  if (/^gemma-4-/.test(model)) return 'high';
  return undefined;
}

export function effectiveThinkingLevel(model: string, preferred?: ThinkingLevelSetting): ThinkingLevelSetting | undefined {
  const levels = supportedThinkingLevels(model);
  return preferred && levels.includes(preferred) ? preferred : defaultThinkingLevel(model);
}
