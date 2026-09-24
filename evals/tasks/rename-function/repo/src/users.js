const USERS = { 1: 'Ada', 2: 'Linus' };

export function getUsr(id) {
  return USERS[id] ?? null;
}
