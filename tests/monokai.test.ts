import { describe, expect, it } from 'vitest';

describe('Monokai Extended on dark themes (Claude Code 2.1.283)', () => {
  it('colours code as Claude Code does, and leaves light and ANSI themes to the terminal', async () => {
    const chalk = (await import('chalk')).default;
    const { highlightCode, syntaxPalette } = await import('../src/ui/Markdown.js');
    const level = chalk.level;
    chalk.level = 3;
    try {
      const out = highlightCode('function greet() {\n  return "hi";\n}', 'javascript', 'monokai');
      expect(out).toContain('\x1b[38;2;102;217;239mfunction');  // #66d9ef, storage
      expect(out).toContain('\x1b[38;2;166;226;46mgreet');      // #a6e22e, the name
      expect(out).toContain('\x1b[38;2;249;38;114mreturn');     // #f92672, control flow
      expect(out).toContain('\x1b[38;2;230;219;116m"hi"');      // #e6db74, strings
    } finally {
      chalk.level = level;
    }
    expect(syntaxPalette('dark')).toBe('monokai');
    expect(syntaxPalette('dark-daltonized')).toBe('monokai');
    expect(syntaxPalette('light')).toBe('terminal');
    expect(syntaxPalette('dark-ansi')).toBe('terminal');
  });
});
