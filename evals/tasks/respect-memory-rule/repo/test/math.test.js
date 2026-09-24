import test from 'node:test';
import assert from 'node:assert/strict';
import { isOdd } from '../src/math.js';

test('isOdd', () => {
  assert.equal(isOdd(3), true);
  assert.equal(isOdd(-3), true);
});
