import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReportFailure, mockReportSuccess } = vi.hoisted(() => ({
  mockReportFailure: vi.fn(),
  mockReportSuccess: vi.fn(),
}));

vi.mock('~/utils/backend-health', () => ({
  reportBackendFailure: mockReportFailure,
  reportBackendSuccess: mockReportSuccess,
}));

import { getQueryClient } from '~/providers/QueryProvider';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('QueryProvider defaults', () => {
  it('retries infrastructure failures exactly once', () => {
    const retry = getQueryClient().getDefaultOptions().queries?.retry;
    expect(typeof retry).toBe('function');
    const retryFn = retry as (count: number, error: Error) => boolean;
    const infra = new TypeError('Failed to fetch');
    expect(retryFn(0, infra)).toBe(true);
    expect(retryFn(1, infra)).toBe(false);
  });

  it('never retries application errors', () => {
    const retryFn = getQueryClient().getDefaultOptions().queries?.retry as (
      count: number,
      error: Error
    ) => boolean;
    expect(retryFn(0, new Error('Screen not found'))).toBe(false);
    expect(retryFn(0, Object.assign(new Error('unauthorized'), { status: 401 }))).toBe(false);
  });

  it('query and mutation cache callbacks feed the breaker', () => {
    const client = getQueryClient();
    const err = new TypeError('Failed to fetch');
    // The cache config callbacks are invoked by TanStack internals; call them
    // directly here to verify the wiring without spinning up real fetches.
    client.getQueryCache().config.onError?.(err, {} as never);
    client.getMutationCache().config.onError?.(err, undefined, undefined, {} as never, {} as never);
    expect(mockReportFailure).toHaveBeenCalledTimes(2);
    client.getQueryCache().config.onSuccess?.({}, {} as never);
    client
      .getMutationCache()
      .config.onSuccess?.({}, undefined, undefined, {} as never, {} as never);
    expect(mockReportSuccess).toHaveBeenCalledTimes(2);
  });
});
