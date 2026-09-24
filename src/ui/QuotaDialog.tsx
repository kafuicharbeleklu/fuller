import React from 'react';
import { Text } from 'ink';
import { useTheme } from './theme.js';
import { OverlayFrame } from './OverlayFrame.js';
import { Select } from './Select.js';
import { modelLabel } from './modelLabel.js';
import { quotaBar, usageSummary } from '../agent/quotaText.js';
import type { FallbackChoice } from '../agent/gemini.js';
import type { ModelSwitchRequest } from '../agent/loop.js';

/**
 * The model has no key left (or stays overloaded): ask before moving the conversation to the
 * next model, as Gemini CLI's quota dialog does. One bar sums the model's quota over every key;
 * "don't ask again" turns the automatic fallback on (/config → Model fallback).
 */
export const QuotaDialog: React.FC<{ request: ModelSwitchRequest }> = ({ request }) => {
  const theme = useTheme();
  const from = modelLabel(request.from);
  const to = request.to ? modelLabel(request.to) : undefined;
  const overloaded = request.reason === 'overloaded';
  const title = overloaded ? `${from} is overloaded (high demand)`
    : request.reason === 'context' ? `This conversation is too long for ${from}`
    : `Usage limit reached for ${from}`;
  const items: Array<{ label: string; value: FallbackChoice }> = [
    ...(overloaded ? [{ label: 'Keep trying', value: 'retry' as const }] : []),
    ...(to ? [
      { label: `Switch to ${to}`, value: 'switch' as const },
      { label: `Switch to ${to}, and don't ask again`, value: 'always' as const },
    ] : []),
    { label: 'Stop', value: 'stop' as const },
  ];
  return (
    <OverlayFrame title={title} color={theme.warning} hint="Enter to select · Esc to stop">
      {!overloaded && request.reason !== 'context' ? (
        <Text><Text color={theme.warning}>{quotaBar(request.usage.usedFraction)}</Text><Text color={theme.subtle}> {usageSummary(request.usage)}</Text></Text>
      ) : null}
      <Text>{to ? `Continue this conversation with ${to}? The whole conversation is kept.` : 'No other model is available right now.'}</Text>
      <Select items={items} numbered onSelect={(choice) => request.resolve(choice as FallbackChoice)} onCancel={() => request.resolve('stop')} />
    </OverlayFrame>
  );
};
