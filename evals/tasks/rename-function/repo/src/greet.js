import { getUsr } from './users.js';

export function greet(id) {
  const name = getUsr(id);
  return name ? `Hello ${name}` : 'Hello stranger';
}
