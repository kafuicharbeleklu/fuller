import React, { useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import { useTheme, getThemeNames } from './theme.js';
import { Select } from './Select.js';
import { OverlayFrame } from './OverlayFrame.js';
import { syntaxPalette } from './Markdown.js';
import { DiffView } from './DiffView.js';
import { useRawInput } from './useRawInput.js';

const LABELS: Record<string, string> = {
  auto: 'Auto (match terminal)',
  dark: 'Dark mode',
  light: 'Light mode',
  'dark-daltonized': 'Dark mode (colorblind-friendly)',
  'light-daltonized': 'Light mode (colorblind-friendly)',
  'dark-ansi': 'Dark mode (ANSI colors only)',
  'light-ansi': 'Light mode (ANSI colors only)',
};

export function themeLabel(name: string): string {
  return LABELS[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
}

const PREVIEW_DIFF = [
  '--- a/greet.js',
  '+++ b/greet.js',
  '@@ -1,3 +1,3 @@',
  ' function greet() {',
  '-  console.log("Hello, World!");',
  '+  console.log("Hello, Fuller!");',
  ' }',
].join('\n');

interface Props {
  current: string;
  syntaxHighlighting: boolean;
  /** Called on every highlight or ctrl+t so the whole UI previews the choice live. */
  onPreview: (name: string, syntaxHighlighting: boolean) => void;
  onSelect: (name: string, syntaxHighlighting: boolean) => void;
  onCancel: () => void;
}

export const ThemePicker: React.FC<Props> = ({ current, syntaxHighlighting, onPreview, onSelect, onCancel }) => {
  const theme = useTheme();
  const [highlighted, setHighlighted] = useState(current);
  const [syntax, setSyntax] = useState(syntaxHighlighting);

  useRawInput((e) => {
    if (e.name === 'char' && e.ctrl && !e.alt && e.text === 't') {
      setSyntax(!syntax);
      onPreview(highlighted, !syntax);
    }
  });

  const { stdout } = useStdout();
  const rows = stdout.rows || 24;
  const names = getThemeNames();
  // Claude Code draws the theme in use in green, with its ✔, even under the cursor.
  const items = names.map((name) => ({ label: themeLabel(name), value: name, marker: name === current ? '✔' : undefined, color: name === current ? theme.success : undefined }));
  const initialIndex = Math.max(0, names.indexOf(current));
  const showPreview = rows >= 22;
  // Claude Code: the terminal's width less 6, whatever the renderer's layout margin.
  const ruleWidth = Math.max(10, (stdout.columns || 80) - 6);
  // Claude Code: a blank row before the list and before the preview (2.1.283 capture); none when short.
  const spaced = rows >= 16;
  const maxVisible = Math.max(3, Math.min(names.length, rows - (showPreview ? 20 : 12)));

  return (
    <OverlayFrame
      title="Theme"
      hint="Enter to select · Esc to cancel"
    >
      <Box flexDirection="column">
        <Text bold>Choose the text style that looks best with your terminal</Text>
        <Box marginTop={spaced ? 1 : 0} />
        <Select
          items={items}
          initialIndex={initialIndex}
          numbered
          maxVisible={maxVisible}
          moreLabel="themes"
          onHighlight={(name) => { setHighlighted(name); onPreview(name, syntax); }}
          onSelect={(name) => onSelect(name, syntax)}
          onCancel={onCancel}
        />
        {showPreview ? (
          <Box flexDirection="column" marginTop={spaced ? 1 : 0}>
            <Text color={theme.userPrompt ?? theme.subtle}>{'╌'.repeat(ruleWidth)}</Text>
            <DiffView diff={PREVIEW_DIFF} language="javascript" width={ruleWidth} />
            <Text color={theme.userPrompt ?? theme.subtle}>{'╌'.repeat(ruleWidth)}</Text>
          </Box>
        ) : null}
        <Box marginTop={showPreview ? 0 : 1}>
          <Text color={theme.subtle}>{showPreview ? ' ' : ''}{syntax ? (syntaxPalette(highlighted) === 'monokai' ? 'Syntax theme: Monokai Extended' : 'Syntax theme: terminal colors') : 'Syntax highlighting disabled'} (ctrl+t to {syntax ? 'disable' : 'enable'})</Text>
        </Box>
      </Box>
    </OverlayFrame>
  );
};
