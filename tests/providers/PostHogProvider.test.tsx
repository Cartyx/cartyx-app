import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostHogProvider } from '~/providers/PostHogProvider';

let posthogReady = false;
let routeResolvedHandler: ((event: { toLocation: { href: string } }) => void) | null = null;

const {
  mockSubscribe,
  mockUseAuthContext,
  mockReactPostHogProvider,
  mockPosthog,
  mockCapturePageView,
  mockGetPostHogInstance,
  mockSetPostHogInstance,
} = vi.hoisted(() => ({
  mockSubscribe: vi.fn(),
  mockUseAuthContext: vi.fn(),
  mockReactPostHogProvider: vi.fn(({ children }: { children: ReactNode }) => (
    <div data-testid="react-posthog-provider">{children}</div>
  )),
  mockPosthog: {
    init: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    reloadFeatureFlags: vi.fn(),
  },
  mockCapturePageView: vi.fn(),
  mockGetPostHogInstance: vi.fn(() => (posthogReady ? mockPosthog : null)),
  mockSetPostHogInstance: vi.fn(() => {
    posthogReady = true;
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    subscribe: mockSubscribe.mockImplementation(
      (_event: string, handler: typeof routeResolvedHandler) => {
        routeResolvedHandler = handler;
        return vi.fn();
      }
    ),
  }),
}));

vi.mock('@posthog/react', () => ({
  PostHogProvider: mockReactPostHogProvider,
}));

vi.mock('posthog-js', () => ({
  default: mockPosthog,
}));

vi.mock('~/providers/AuthProvider', () => ({
  useAuthContext: mockUseAuthContext,
}));

vi.mock('~/utils/posthog-client', () => ({
  captureException: vi.fn(),
  captureEvent: vi.fn(),
  capturePageView: mockCapturePageView,
  getPostHogInstance: mockGetPostHogInstance,
  isPostHogReady: vi.fn(() => posthogReady),
  setPostHogInstance: mockSetPostHogInstance,
  throttleExceptionEvent: vi.fn((event: unknown) => event),
}));

describe('PostHogProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_PUBLIC_POSTHOG_KEY', 'test-key');
    vi.stubEnv('VITE_PUBLIC_POSTHOG_HOST', 'https://us.i.posthog.com');
    posthogReady = false;
    routeResolvedHandler = null;
    mockUseAuthContext.mockReturnValue({
      user: {
        id: 'user-1',
        name: 'Taryon',
        email: 'taryon@example.com',
        provider: 'google',
        role: 'gm',
      },
    });
  });

  it('initializes PostHog, wires the React provider, and tracks page views', async () => {
    render(
      <PostHogProvider>
        <div>children</div>
      </PostHogProvider>
    );

    await waitFor(() => {
      expect(mockPosthog.init).toHaveBeenCalledWith('test-key', {
        api_host: 'https://us.i.posthog.com',
        capture_pageview: false,
        persistence: 'localStorage+cookie',
        capture_exceptions: true,
        before_send: expect.any(Function),
      });
    });

    await waitFor(() => {
      expect(mockReactPostHogProvider).toHaveBeenCalledWith(
        expect.objectContaining({ client: mockPosthog, children: expect.anything() }),
        undefined
      );
    });

    expect(mockSetPostHogInstance).toHaveBeenCalledWith(mockPosthog);
    expect(mockCapturePageView).toHaveBeenCalledWith('http://localhost:3000/');
    expect(mockSubscribe).toHaveBeenCalledWith('onResolved', expect.any(Function));
    expect(screen.getByText('children')).toBeInTheDocument();

    routeResolvedHandler?.({ toLocation: { href: '/campaigns/demo' } });

    expect(mockCapturePageView).toHaveBeenLastCalledWith('http://localhost:3000/campaigns/demo');
  });

  it('identifies authenticated users and refreshes feature flags', async () => {
    render(
      <PostHogProvider>
        <div />
      </PostHogProvider>
    );

    await waitFor(() => {
      expect(mockPosthog.identify).toHaveBeenCalledWith('user-1', {
        name: 'Taryon',
        email: 'taryon@example.com',
        provider: 'google',
        role: 'gm',
      });
    });
    expect(mockPosthog.reloadFeatureFlags).toHaveBeenCalledTimes(1);
  });

  it('resets anonymous sessions and refreshes feature flags', async () => {
    mockUseAuthContext.mockReturnValue({ user: null });

    render(
      <PostHogProvider>
        <div />
      </PostHogProvider>
    );

    await waitFor(() => {
      expect(mockPosthog.reset).toHaveBeenCalledTimes(1);
    });
    expect(mockPosthog.reloadFeatureFlags).toHaveBeenCalledTimes(1);
  });

  it('skips loading PostHog entirely when the client key is absent', async () => {
    vi.stubEnv('VITE_PUBLIC_POSTHOG_KEY', '');

    render(
      <PostHogProvider>
        <div>children</div>
      </PostHogProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('children')).toBeInTheDocument();
    });

    expect(mockPosthog.init).not.toHaveBeenCalled();
    expect(mockReactPostHogProvider).not.toHaveBeenCalled();
    expect(mockSetPostHogInstance).not.toHaveBeenCalled();
    expect(mockSubscribe).not.toHaveBeenCalled();
    expect(mockCapturePageView).not.toHaveBeenCalled();
  });
});
