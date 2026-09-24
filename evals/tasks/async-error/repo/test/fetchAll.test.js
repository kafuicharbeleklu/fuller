import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAll } from '../src/fetchAll.js';

test('collects values and failures', async () => {
  const res = await fetchAll([async () => 1, async () => { throw new Error('boom'); }, async () => 3]);
  assert.deepEqual(res, { ok: [1, 3], failed: ['boom'] });
});
