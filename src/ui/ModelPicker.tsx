import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './theme.js';
import { Select } from './Select.js';
import { listChatModels, freeTierStatus, FREE_TIER_VERIFIED, RECENT_MIN_VERSION, type ModelInfo } from '../agent/models.js';
import { useRawInput } from './useRawInput.js';
import { formatTokens } from '../tools/truncate.js';

interface Props {
  apiKey: string;
  current: string;
  onSelect: (model: ModelInfo) => void;
  onCancel: () => void;
}

export const ModelPicker: React.FC<Props> = ({ apiKey, current, onSelect, onCancel }) => {
  const theme = useTheme();
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setModels(null);
    listChatModels(apiKey, { all: showAll })
      .then((m) => { if (!cancelled) setModels(m); })
      .catch((err) => { if (!cancelled) setError(err?.message ?? String(err)); });
    return () => { cancelled = true; };
  }, [apiKey, showAll]);

  useRawInput((e) => {
    if (e.name === 'char' && e.text === 'a' && !e.ctrl && !e.alt) setShowAll((v) => !v);
  });

  const tierLabel = (id: string) => ({ free: 'free', paid: 'paid — no free tier', unknown: 'free tier unknown' } as const)[freeTierStatus(id)];
  const items = (models ?? []).map((m) => ({
    label: m.id,
    value: m.id,
    hint: `${m.displayName} · ${formatTokens(m.inputTokenLimit)} ctx · ${tierLabel(m.id)}${m.id === current ? ' · current' : ''}`,
    color: m.id === current ? theme.accent : freeTierStatus(m.id) === 'paid' ? theme.warning : undefined,
  }));
  const initialIndex = Math.max(0, items.findIndex((i) => i.value === current));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1} marginTop={1}>
      <Text bold color={theme.accent}>Select a model{showAll ? ' — all chat models' : ` — recent (≥ ${RECENT_MIN_VERSION}) and free of charge`}</Text>
      <Text color={theme.subtle}>↑/↓ select · enter confirm · esc cancel · a {showAll ? 'show recommended only' : 'show all models'}. Free tier per pricing page ({FREE_TIER_VERIFIED}). History is kept.</Text>
      <Box marginTop={1} flexDirection="column">
        {error ? <Text color={theme.error}>✗ {error}</Text> : null}
        {!models && !error ? <Text color={theme.subtle}>Loading models…</Text> : null}
        {models && models.length === 0 ? <Text color={theme.warning}>No chat model found for this key.</Text> : null}
        {models && models.length > 0 ? (
          <Select
            items={items}
            initialIndex={initialIndex}
            numbered={false}
            maxVisible={14}
            onSelect={(id) => { const m = models.find((x) => x.id === id); if (m) onSelect(m); }}
            onCancel={onCancel}
          />
        ) : null}
        {error ? <Select items={[{ label: 'Close', value: 'close' }]} numbered={false} onSelect={onCancel} onCancel={onCancel} /> : null}
      </Box>
    </Box>
  );
};
