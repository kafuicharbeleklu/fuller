/** Human-readable Gemini model name for the terminal chrome. */
export function modelLabel(model: string): string {
  const name = model.replace(/^models\//, '');
  // gemma-4-26b-a4b-it → "Gemma 4 26B A4B" (Google DeepMind's naming).
  const gemma = name.match(/^gemma-(\d+(?:\.\d+)?)-(.+?)(?:-it)?$/);
  if (gemma) return `Gemma ${gemma[1]} ${gemma[2].split('-').map((part) => part.toUpperCase()).join(' ')}`;
  if (!name.startsWith('gemini-')) return name;
  return `Gemini ${name.slice('gemini-'.length).split('-').map((part) =>
    ['flash', 'pro', 'lite', 'preview'].includes(part) ? part[0].toUpperCase() + part.slice(1) : part
  ).join(' ')}`;
}
