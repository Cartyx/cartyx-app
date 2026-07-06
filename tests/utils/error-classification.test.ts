import { describe, it, expect } from 'vitest';
import { isInfrastructureFailure, BackendUnavailableError } from '~/utils/error-classification';

describe('isInfrastructureFailure', () => {
  it('classifies fetch network errors as infrastructure', () => {
    expect(isInfrastructureFailure(new TypeError('Failed to fetch'))).toBe(true); // Chrome
    expect(isInfrastructureFailure(new TypeError('Load failed'))).toBe(true); // Safari
    expect(
      isInfrastructureFailure(new TypeError('NetworkError when attempting to fetch resource.'))
    ).toBe(true); // Firefox
  });

  it('classifies errors carrying a 5xx status as infrastructure', () => {
    const err = Object.assign(new Error('Internal Server Error'), { status: 500 });
    expect(isInfrastructureFailure(err)).toBe(true);
    expect(isInfrastructureFailure(Object.assign(new Error('bad gateway'), { status: 502 }))).toBe(
      true
    );
  });

  it('classifies timeouts as infrastructure', () => {
    const err = new Error('signal timed out');
    err.name = 'TimeoutError';
    expect(isInfrastructureFailure(err)).toBe(true);
  });

  it('does NOT classify application errors, 4xx, aborts, or non-errors', () => {
    expect(isInfrastructureFailure(new Error('Screen not found in this campaign'))).toBe(false);
    expect(isInfrastructureFailure(Object.assign(new Error('unauthorized'), { status: 401 }))).toBe(
      false
    );
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(isInfrastructureFailure(abort)).toBe(false);
    expect(isInfrastructureFailure('string error')).toBe(false);
    expect(isInfrastructureFailure(null)).toBe(false);
  });

  it('does NOT classify BackendUnavailableError (never feeds the breaker its own output)', () => {
    expect(isInfrastructureFailure(new BackendUnavailableError())).toBe(false);
  });
});

describe('BackendUnavailableError', () => {
  it('has a stable name and message', () => {
    const err = new BackendUnavailableError();
    expect(err.name).toBe('BackendUnavailableError');
    expect(err.message).toBe('Backend temporarily unavailable — reconnecting');
    expect(err).toBeInstanceOf(Error);
  });
});
