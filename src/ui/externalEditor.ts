import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const onPath = (command: string) => (process.env.PATH ?? '').split(path.delimiter).some((dir) => dir && fs.existsSync(path.join(dir, command)));

/** $VISUAL, then $EDITOR, then VS Code when installed (as Claude Code does), then vi or notepad. */
export function resolveEditor(): string {
  return process.env.VISUAL || process.env.EDITOR || (onPath('code') ? 'code --wait' : process.platform === 'win32' ? 'notepad' : 'vi');
}

/** Human name of the editor for hints such as "ctrl+g to edit in VS Code". */
export function editorName(editor = resolveEditor()): string {
  const command = path.basename(editor.trim().split(/\s+/)[0] ?? '').replace(/\.exe$/i, '');
  return ({ code: 'VS Code', 'code-insiders': 'VS Code Insiders', cursor: 'Cursor', subl: 'Sublime Text', nvim: 'Neovim', vim: 'Vim', vi: 'Vi', nano: 'nano', emacs: 'Emacs', notepad: 'Notepad' } as Record<string, string>)[command] ?? command;
}

/** Open a prompt in $VISUAL or $EDITOR without passing the prompt through a shell. */
export function editPromptExternally(text: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-prompt-'));
  const file = path.join(directory, 'prompt.md');
  fs.writeFileSync(file, text, { encoding: 'utf8', mode: 0o600 });
  try {
    const editor = resolveEditor();
    const parts = editor.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((part) => part.replace(/^(["'])(.*)\1$/, '$2')) ?? [];
    if (parts.length === 0) throw new Error('No editor configured. Set VISUAL or EDITOR.');
    const result = spawnSync(parts[0], [...parts.slice(1), file], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Editor exited with status ${result.status}`);
    return fs.readFileSync(file, 'utf8').replace(/\n$/, '');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
