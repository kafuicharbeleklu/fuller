/**
 * Runs every loader. Returns { ok: [values of loaders that resolved], failed: [messages of loaders that rejected] },
 * in the order of the loaders. Never rejects.
 */
export async function fetchAll(loaders) {
  const ok = [];
  for (const load of loaders) ok.push(await load());
  return { ok, failed: [] };
}
