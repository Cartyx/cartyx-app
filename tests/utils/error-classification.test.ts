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

  it('classifies proxy/platform error bodies rethrown by the server-fn fetcher', () => {
    expect(isInfrastructureFailure(new Error('502 Bad Gateway'))).toBe(true);
    expect(isInfrastructureFailure(new Error('503 Service Unavailable'))).toBe(true);
    expect(isInfrastructureFailure(new Error('504 Gateway Timeout'))).toBe(true);
    expect(isInfrastructureFailure(new Error('504 Gateway Time-out'))).toBe(true);
    expect(isInfrastructureFailure(new Error('upstream connect error: gateway timeout'))).toBe(
      true
    );
  });

  it('classifies deploy-rollover manifest misses', () => {
    expect(isInfrastructureFailure(new Error('Server function info not found.'))).toBe(true);
  });

  it('classifies Mongo/driver infra messages that cross the wire untagged', () => {
    expect(isInfrastructureFailure(new Error('Server selection timed out after 30000 ms'))).toBe(
      true
    );
    expect(isInfrastructureFailure(new Error('connect ECONNREFUSED 127.0.0.1:27017'))).toBe(true);
    expect(isInfrastructureFailure(new Error('read ECONNRESET'))).toBe(true);
    expect(isInfrastructureFailure(new Error('connect ETIMEDOUT'))).toBe(true);
    expect(isInfrastructureFailure(new Error('queryA EAI_AGAIN cluster0.mongodb.net'))).toBe(true);
    expect(isInfrastructureFailure(new Error('getaddrinfo ENOTFOUND cluster0.mongodb.net'))).toBe(
      true
    );
    expect(isInfrastructureFailure(new Error('socket hang up'))).toBe(true);
    expect(isInfrastructureFailure(new Error('topology was closed'))).toBe(true);
    expect(isInfrastructureFailure(new Error('Topology is destroyed'))).toBe(true);
  });

  it('classifies DB-disconnected messages that cross the wire untagged (status is dropped by seroval)', () => {
    expect(isInfrastructureFailure(new Error('Database not connected'))).toBe(true);
    expect(isInfrastructureFailure(new Error('upsertUser: database not connected'))).toBe(true);
  });

  it('still does NOT classify ordinary app errors after the pattern extension', () => {
    expect(isInfrastructureFailure(new Error('Screen 42 not found in this campaign'))).toBe(false);
    expect(isInfrastructureFailure(new Error('unauthorized'))).toBe(false);
    expect(
      isInfrastructureFailure(
        new Error('Invalid input: expected string, received number at "name"')
      )
    ).toBe(false);
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
