import test from 'node:test';
import assert from 'node:assert/strict';
import { greet } from '../src/greet.js';
import { getUser } from '../src/users.js';

test('greet', () => {
  assert.equal(greet(1), 'Hello Ada');
  assert.equal(greet(9), 'Hello stranger');
  assert.equal(getUser(2), 'Linus');
});
