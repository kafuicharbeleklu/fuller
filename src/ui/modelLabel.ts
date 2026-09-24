/** Human-readable Gemini model name for the terminal chrome. */
export function modelLabel(model: string): string {
  const name = model.replace(/^models\//, '');
  if (!name.startsWith('gemini-')) return name;
  return `Gemini ${name.slice('gemini-'.length).split('-').map((part) =>
    ['flash', 'pro', 'lite', 'preview'].includes(part) ? part[0].toUpperCase() + part.slice(1) : part
  ).join(' ')}`;
}
