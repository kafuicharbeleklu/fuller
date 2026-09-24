import { describe, expect, it } from 'vitest';
import { classifyKeyError } from '../src/agent/keyCheck.js';

describe('fuller --check-keys', () => {
  it('sorts API errors into what they mean for the key, without showing it', () => {
    expect(classifyKeyError(Object.assign(new Error('{"error":{"code":403,"message":"Your project has been denied access. Please contact support."}}'), { status: 403 })).health).toBe('denied');
    expect(classifyKeyError(Object.assign(new Error('Quota exceeded for metric GenerateRequestsPerDayPerProjectPerModel'), { status: 429 }))).toEqual({ health: 'quota', detail: 'daily quota reached' });
    expect(classifyKeyError(Object.assign(new Error('This model is currently experiencing high demand.'), { status: 503 })).health).toBe('overloaded');
    expect(classifyKeyError(new Error('API key not valid. Please pass a valid API key.')).health).toBe('invalid');
    expect(classifyKeyError(new Error('boom AQ.Ab8RN6secretsecretsecret')).detail).not.toContain('secret');
  });
});
