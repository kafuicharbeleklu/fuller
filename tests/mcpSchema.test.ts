import { describe, expect, it } from 'vitest';
import { toGeminiSchema, mcpToolName, parseMcpToolName } from '../src/mcp/schema.js';
import { expandEnv } from '../src/mcp/config.js';

describe('MCP schema conversion', () => {
  it('maps JSON Schema to Gemini schema types', () => {
    const out = toGeminiSchema({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text' },
        limit: { type: ['integer', 'null'], minimum: 1 },
        tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } },
        opts: { anyOf: [{ type: 'object', properties: { deep: { type: 'boolean' } } }, { type: 'null' }] },
      },
      required: ['query', 'missing'],
      additionalProperties: false,
      $schema: 'http://json-schema.org/draft-07/schema#',
    });
    expect(out.type).toBe('OBJECT');
    expect(out.properties.query).toEqual({ type: 'STRING', description: 'Search text' });
    expect(out.properties.limit).toEqual({ type: 'INTEGER', nullable: true });
    expect(out.properties.tags).toEqual({ type: 'ARRAY', items: { type: 'STRING', enum: ['a', 'b'] } });
    expect(out.properties.opts.type).toBe('OBJECT');
    expect(out.properties.opts.nullable).toBe(true);
    expect(out.required).toEqual(['query']);
    expect(out).not.toHaveProperty('$schema');
  });
  it('gives empty objects a placeholder property', () => {
    expect(toGeminiSchema({ type: 'object' }).properties.input.type).toBe('STRING');
  });
  it('builds and parses tool names', () => {
    expect(mcpToolName('github', 'search-issues')).toBe('mcp__github__search_issues');
    expect(parseMcpToolName('mcp__github__search_issues')).toEqual({ server: 'github', tool: 'search_issues' });
    expect(parseMcpToolName('read_file')).toBeNull();
  });
});

describe('MCP config env expansion', () => {
  it('expands ${VAR} and defaults', () => {
    process.env.FULLER_TEST_TOKEN = 'abc';
    expect(expandEnv({ command: 'npx', args: ['-y', 'srv', '--token', '${FULLER_TEST_TOKEN}'], env: { X: '${NOPE:-dflt}' } })).toEqual({ command: 'npx', args: ['-y', 'srv', '--token', 'abc'], env: { X: 'dflt' } });
  });
});
