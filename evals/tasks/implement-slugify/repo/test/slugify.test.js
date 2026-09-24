import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slugify.js';

test('slugify', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
  assert.equal(slugify('  Crème brûlée à Paris!  '), 'creme-brulee-a-paris');
  assert.equal(slugify('a -- b'), 'a-b');
  assert.equal(slugify(''), '');
});
