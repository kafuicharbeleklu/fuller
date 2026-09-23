import { describe, expect, it } from 'vitest';
import { normalizeTodos, formatTodos } from '../src/tools/registry.js';

describe('todo_write', () => {
  it('normalizes and validates items', () => {
    const todos = normalizeTodos([
      { content: 'Write tests', status: 'completed' },
      { content: 'Run them', status: 'in_progress', activeForm: 'Running the tests' },
      { content: 'Ship', status: 'pending' },
    ]);
    expect(todos).toHaveLength(3);
    expect(formatTodos(todos)).toBe('☑ Write tests\n◐ Running the tests\n☐ Ship');
  });
  it('rejects malformed lists', () => {
    expect(() => normalizeTodos('nope')).toThrow(/array/);
    expect(() => normalizeTodos([{ content: '', status: 'pending' }])).toThrow(/content/);
    expect(() => normalizeTodos([{ content: 'x', status: 'done' }])).toThrow(/status/);
  });
});
