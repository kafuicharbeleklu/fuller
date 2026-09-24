import React, { useEffect, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import { useTheme } from './theme.js';
import { Select } from './Select.js';
import { OverlayFrame } from './OverlayFrame.js';
import { listChatModels, isRecommendedModel, freeTierStatus, type ModelInfo } from '../agent/models.js';
import { useRawInput } from './useRawInput.js';
import { modelLabel } from './modelLabel.js';
import { defaultThinkingLevel, effectiveThinkingLevel, supportedThinkingLevels, type ThinkingLevelSetting } from '../agent/thinking.js';
import { EFFORT_GLYPHS } from './Footer.js';
import stringWidth from 'string-width';

/** "1M context", "128K context": Claude Code's wording for the context window. */
export function contextLabel(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 1_048_576) || 1}M context`;
  return `${Math.round(tokens / 1024)}K context`;
}

const LEVEL_ORDER: ThinkingLevelSetting[] = ['minimal', 'low', 'medium', 'high'];

/** The chosen level when `model` supports it, else its nearest supported level, else the model default. */
export function keepLevel(model: string, level: ThinkingLevelSetting | undefined): ThinkingLevelSetting | undefined {
  const levels = supportedThinkingLevels(model);
  if (!levels.length) return undefined;
  if (!level) return defaultThinkingLevel(model);
  if (levels.includes(level)) return level;
  const rank = LEVEL_ORDER.indexOf(level);
  return [...levels].sort((a, b) => Math.abs(LEVEL_ORDER.indexOf(a) - rank) - Math.abs(LEVEL_ORDER.indexOf(b) - rank))[0];
}

/** "Medium", "Minimal": level names as Claude Code capitalises them. */
export const effortName = (level: string) => level[0].toUpperCase() + level.slice(1);

/** The API error message alone, not the JSON body around it. */
function errorMessage(error: string): string {
  try { return JSON.parse(error.slice(error.indexOf('{'))).error?.message ?? error; } catch { return error; }
}

interface Props {
  apiKey: string;
  current: string;
  thinkingLevel?: ThinkingLevelSetting;
  onSelect: (model: ModelInfo, scope: 'default' | 'session', thinkingLevel?: ThinkingLevelSetting) => void;
  onCancel: () => void;
}

export const ModelPicker: React.FC<Props> = ({ apiKey, current, thinkingLevel, onSelect, onCancel }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [highlighted, setHighlighted] = useState(current);
  const [effort, setEffort] = useState<ThinkingLevelSetting | undefined>(effectiveThinkingLevel(current, thinkingLevel));

  useEffect(() => {
    let cancelled = false;
    setModels(null);
    setError(null);
    listChatModels(apiKey, { all: true })
      .then((all) => {
        if (cancelled) return;
        const visible = showAll ? all : all.filter((m) => isRecommendedModel(m) || m.id === current);
        if (!visible.some((m) => m.id === current)) {
          visible.push({ id: current, displayName: modelLabel(current), inputTokenLimit: 0, outputTokenLimit: 0, actions: ['generateContent'] });
        }
        setModels(visible);
      })
      .catch((err) => { if (!cancelled) setError(err?.message ?? String(err)); });
    return () => { cancelled = true; };
  }, [apiKey, current, showAll]);

  useRawInput((e) => {
    if (e.name === 'char' && e.text === 'a' && !e.ctrl && !e.alt) setShowAll((v) => !v);
    else if (e.name === 'left' || e.name === 'right') {
      // Claude Code cycles through the levels and wraps around at both ends.
      const levels = supportedThinkingLevels(highlighted);
      if (!levels.length) return;
      const position = Math.max(0, levels.indexOf(effort ?? defaultThinkingLevel(highlighted) ?? levels[0]));
      setEffort(levels[(position + (e.name === 'left' ? -1 : 1) + levels.length) % levels.length]);
    }
    else if ((!models || error) && (e.name === 'escape' || (e.name === 'char' && e.ctrl && e.text === 'c'))) onCancel();
  });

  const width = Math.max(1, (stdout.columns || 80) - 1);
  const maxVisible = Math.max(1, Math.min(8, (stdout.rows || 24) - 10));
  const actionHint = width < 40 ? 'Enter save · s once · Esc' : width >= 72 ? 'Enter to set as default · s to use this session only · Esc to cancel' : 'Enter default · s session only · Esc cancel';
  const tierLabel = (id: string) => ({ free: '', paid: ' · paid', unknown: ' · free tier unknown' } as const)[freeTierStatus(id)];
  const items = (models ?? []).map((m) => {
    const cleaned = m.description?.replace(/\s+/g, ' ').trim();
    // The API often returns the display name as description; it would repeat the label.
    const description = cleaned && cleaned !== modelLabel(m.id) && cleaned !== m.displayName ? cleaned : undefined;
    return {
      label: modelLabel(m.id),
      value: m.id,
      // Claude Code: "<context> · <description>" in grey after a fixed label column.
      hint: width >= 60 ? `${m.inputTokenLimit ? contextLabel(m.inputTokenLimit) : m.id}${description ? ` · ${description}` : ''}${tierLabel(m.id)}` : undefined,
      marker: m.id === current ? '✔' : undefined,
      // The current model in green, as Claude Code does; paid models in the warning colour.
      color: m.id === current ? theme.success : freeTierStatus(m.id) === 'paid' ? theme.warning : undefined,
    };
  });
  const labelWidth = Math.min(Math.max(8, width - 12), Math.max(0, ...items.map((item) => stringWidth(item.label) + (item.marker ? 2 : 0))) + 2);
  const initialIndex = Math.max(0, items.findIndex((i) => i.value === current));
  const shownEffort = effort ?? defaultThinkingLevel(highlighted);
  const currentEffort = effectiveThinkingLevel(current, thinkingLevel);

  return (
    <OverlayFrame
      title="Select model"
      description={`Switch between Gemini models. Your pick becomes the default for new sessions. ${showAll ? 'Press a for recommended models only.' : 'Press a for all models, or use /model <name>.'}`}
      hint={actionHint}
      ruleLabel={currentEffort ? `${EFFORT_GLYPHS[currentEffort] ?? '◐'} ${currentEffort} · /effort` : undefined}
    >
      <Box flexDirection="column">
        {error ? <Text color={theme.error}>✗ {errorMessage(error)}</Text> : null}
        {!models && !error ? <Text color={theme.subtle}>Loading models…</Text> : null}
        {models && models.length > 0 ? (
          <Select
            key={showAll ? 'all' : 'recommended'}
            items={items}
            initialIndex={initialIndex}
            numbered
            maxVisible={maxVisible}
            labelWidth={labelWidth}
            moreLabel="models"
            shortcutKey="s"
            onHighlight={(id) => {
              if (id === highlighted) return;
              setHighlighted(id);
              // Claude Code keeps the chosen level while moving between models.
              setEffort((level) => keepLevel(id, level));
            }}
            onSelect={(id) => { const m = models.find((x) => x.id === id); if (m) onSelect(m, 'default', keepLevel(id, effort)); }}
            onShortcutSelect={(id) => { const m = models.find((x) => x.id === id); if (m) onSelect(m, 'session', keepLevel(id, effort)); }}
            onCancel={onCancel}
          />
        ) : null}
        {shownEffort && supportedThinkingLevels(highlighted).length ? (
          <Text>
            <Text color={theme.accent}>{EFFORT_GLYPHS[shownEffort] ?? '◐'} </Text>
            <Text color={theme.subtle}>{effortName(shownEffort)} effort{shownEffort === defaultThinkingLevel(highlighted) ? ' (default)' : ''} </Text>
            <Text color={theme.subtle} dimColor>←/→ to adjust</Text>
          </Text>
        ) : null}
      </Box>
    </OverlayFrame>
  );
};
