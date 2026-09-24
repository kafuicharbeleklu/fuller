/** Sum of the integers from a to b, both included. */
export function sumRange(a, b) {
  let total = 0;
  for (let i = a; i < b; i++) total += i;
  return total;
}
