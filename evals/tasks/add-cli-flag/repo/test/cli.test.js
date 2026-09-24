import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('greets', () => {
  assert.equal(execFileSync('node', ['cli.js', 'Ada']).toString().trim(), 'Hello Ada');
});
