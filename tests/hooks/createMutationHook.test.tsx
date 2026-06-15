import React, { type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const captureException = vi.fn();
vi.mock('~/providers/PostHogProvider', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

import { createMutationHook } from '~/hooks/createMutationHook';

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

interface Input {
  id: string;
  campaignId: string;
}

describe('createMutationHook', () => {
  beforeEach(() => {
    captureException.mockClear();
  });

  it('exposes the action under the configured name plus isLoading/error', () => {
    const useThing = createMutationHook({
      actionName: 'doThing',
      mutationFn: async (_input: Input) => ({ ok: true }),
      errorContext: () => ({ action: 'doThing' }),
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useThing(), { wrapper });

    expect(typeof (result.current as Record<string, unknown>).doThing).toBe('function');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns the resolved data on success and runs onSuccess with the query client + data + variables', async () => {
    const onSuccess = vi.fn();
    const useThing = createMutationHook({
      actionName: 'doThing',
      mutationFn: async (input: Input) => ({ saved: input.id }),
      onSuccess,
      errorContext: () => ({ action: 'doThing' }),
    });
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useThing(), { wrapper });

    let returned: unknown;
    await act(async () => {
      returned = await (result.current as { doThing: (i: Input) => Promise<unknown> }).doThing({
        id: 'x',
        campaignId: 'c',
      });
    });

    expect(returned).toEqual({ saved: 'x' });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(
      queryClient,
      { saved: 'x' },
      { id: 'x', campaignId: 'c' }
    );
  });

  it('returns null on error, reports via captureException with built context, and exposes the message', async () => {
    const useThing = createMutationHook({
      actionName: 'doThing',
      mutationFn: async (_input: Input) => {
        throw new Error('kaboom');
      },
      errorContext: (vars: Input) => ({ action: 'doThing', id: vars.id }),
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useThing(), { wrapper });

    let returned: unknown = 'sentinel';
    await act(async () => {
      returned = await (result.current as { doThing: (i: Input) => Promise<unknown> }).doThing({
        id: 'y',
        campaignId: 'c',
      });
    });

    expect(returned).toBeNull();
    expect(captureException).toHaveBeenCalledTimes(1);
    const [err, ctx] = captureException.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('kaboom');
    expect(ctx).toEqual({ action: 'doThing', id: 'y' });

    await waitFor(() => expect(result.current.error).toBe('kaboom'));
  });

  it('does not throw when onSuccess is omitted', async () => {
    const useThing = createMutationHook({
      actionName: 'validate',
      mutationFn: async (_input: Input) => ({ valid: true }),
      errorContext: () => ({ action: 'validate' }),
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useThing(), { wrapper });

    let returned: unknown;
    await act(async () => {
      returned = await (result.current as { validate: (i: Input) => Promise<unknown> }).validate({
        id: 'z',
        campaignId: 'c',
      });
    });
    expect(returned).toEqual({ valid: true });
  });
});
