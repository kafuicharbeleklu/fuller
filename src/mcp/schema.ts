/**
 * Convert a JSON Schema (as published by MCP servers) into the subset accepted
 * by the Gemini API function declarations (OpenAPI-style Schema objects).
 */
const TYPE_MAP: Record<string, string> = {
  string: 'STRING', number: 'NUMBER', integer: 'INTEGER', boolean: 'BOOLEAN', array: 'ARRAY', object: 'OBJECT',
};

export function toGeminiSchema(schema: any, depth = 0): any {
  if (!schema || typeof schema !== 'object' || depth > 8) return { type: 'STRING' };
  if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf) || Array.isArray(schema.allOf)) {
    const variants = (schema.anyOf ?? schema.oneOf ?? schema.allOf) as any[];
    const nonNull = variants.filter((v) => v && v.type !== 'null');
    const base = toGeminiSchema(nonNull[0] ?? {}, depth + 1);
    if (nonNull.length !== variants.length) base.nullable = true;
    if (schema.description && !base.description) base.description = schema.description;
    return base;
  }
  let type = Array.isArray(schema.type) ? schema.type.find((t: string) => t !== 'null') : schema.type;
  const nullable = Array.isArray(schema.type) && schema.type.includes('null');
  if (!type) type = schema.properties ? 'object' : schema.items ? 'array' : schema.enum ? 'string' : 'string';
  const out: any = { type: TYPE_MAP[type] ?? 'STRING' };
  if (typeof schema.description === 'string') out.description = schema.description.slice(0, 1000);
  if (nullable) out.nullable = true;
  if (Array.isArray(schema.enum)) out.enum = schema.enum.map((e: unknown) => String(e));
  if (out.type === 'OBJECT') {
    const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    out.properties = {};
    for (const [k, v] of Object.entries(props)) out.properties[k] = toGeminiSchema(v, depth + 1);
    if (Array.isArray(schema.required)) {
      const required = schema.required.filter((r: unknown) => typeof r === 'string' && r in out.properties);
      if (required.length) out.required = required;
    }
    if (Object.keys(out.properties).length === 0) {
      // Gemini rejects empty object schemas; describe free-form input instead.
      out.properties = { input: { type: 'STRING', description: 'Free-form input (JSON string) for this tool.' } };
    }
  }
  if (out.type === 'ARRAY') out.items = toGeminiSchema(schema.items ?? { type: 'string' }, depth + 1);
  return out;
}

export function mcpToolName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`.replace(/[^\w]/g, '_').slice(0, 64);
}

export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  const m = name.match(/^mcp__([^_](?:[\w-]*?))__(.+)$/);
  if (!m) return null;
  return { server: m[1], tool: m[2] };
}
