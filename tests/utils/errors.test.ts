import { describe, it, expect } from 'vitest';
import { extractErrorMessage } from '~/utils/errors';

describe('extractErrorMessage', () => {
  it('returns null for null/undefined', () => {
    expect(extractErrorMessage(null)).toBeNull();
    expect(extractErrorMessage(undefined)).toBeNull();
  });

  it('returns null for other falsy values', () => {
    expect(extractErrorMessage('')).toBeNull();
    expect(extractErrorMessage(0)).toBeNull();
    expect(extractErrorMessage(false)).toBeNull();
  });

  it('returns the message for Error instances', () => {
    expect(extractErrorMessage(new Error('boom'))).toBe('boom');
    expect(extractErrorMessage(new TypeError('bad type'))).toBe('bad type');
  });

  it('stringifies truthy non-Error values', () => {
    expect(extractErrorMessage('plain string')).toBe('plain string');
    expect(extractErrorMessage(42)).toBe('42');
    expect(extractErrorMessage({ toString: () => 'custom' })).toBe('custom');
  });
});
