export function subtotal(items) {
  return items.reduce((s, i) => s + i.price * i.qty, 0);
}
