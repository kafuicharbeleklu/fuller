import { describe, expect, it } from 'vitest';
import { ThinkingLevel } from '@google/genai';
import { getConfig } from '../src/config.js';
import { GeminiAgentSession } from '../src/agent/gemini.js';
import { supportedThinkingLevels } from '../src/agent/thinking.js';

describe('Gemini thinking levels', () => {
  it('sends a supported level in the chat request configuration', () => {
    const config = getConfig({ apiKey: 'test', model: 'gemini-3.8-flash' });
    config.thinkingLevel = 'low';
    const session = new GeminiAgentSession(config);
    expect((session as any).chatConfig.thinkingConfig.thinkingLevel).toBe(ThinkingLevel.LOW);
    expect(supportedThinkingLevels(config.model)).toEqual(['low', 'medium', 'high']);
  });

  it('omits the unsupported level parameter for Gemini 2.5', () => {
    const config = getConfig({ apiKey: 'test', model: 'gemini-2.5-pro' });
    config.thinkingLevel = 'low';
    const session = new GeminiAgentSession(config);
    expect((session as any).chatConfig.thinkingConfig).toBeUndefined();
  });
});
