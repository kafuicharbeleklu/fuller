import { subtotal } from './cart.js';

const TAX = 0.18;

export function computeGrandTotal(items) {
  const net = subtotal(items);
  return Math.round(net * (1 + TAX) * 100) / 100;
}
