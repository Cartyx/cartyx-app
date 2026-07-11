import {
  createRootRoute,
  Outlet,
  ScrollRestoration,
  HeadContent,
  Scripts,
} from '@tanstack/react-router';
import { Component, type ReactNode, type ErrorInfo } from 'react';
import { ConnectionBanner } from '~/components/ConnectionBanner';
import { AuthProvider } from '~/providers/AuthProvider';
import { TelemetryProvider, captureException } from '~/providers/TelemetryProvider';
import { QueryProvider } from '~/providers/QueryProvider';
import '~/styles/globals.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    captureException(error, {
      componentStack: info.componentStack ?? undefined,
      source: 'ErrorBoundary',
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0D1117] flex items-center justify-center text-white">
          <div className="text-center p-8 border border-[#30363d] rounded-lg max-w-md">
            <h1 className="text-2xl font-bold mb-4">Something went wrong</h1>
            <p className="text-gray-400 mb-6">
              An unexpected error occurred. Please try refreshing the page.
            </p>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 rounded text-white font-medium transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Cartyx — D&D Campaign Management' },
      {
        name: 'description',
        content: 'Manage your D&D campaigns, invite players, and forge legendary adventures.',
      },
    ],
    links: [{ rel: 'icon', href: '/favicon.ico' }],
    scripts: [
      // Umami page-view/event tracking; only emitted when the platform env
      // var is baked in (absent locally/CI = no script tag, no tracking).
      ...(import.meta.env.VITE_PUBLIC_UMAMI_WEBSITE_ID
        ? [
            {
              src: 'https://umami.cartyx.io/script.js',
              defer: true,
              'data-website-id': import.meta.env.VITE_PUBLIC_UMAMI_WEBSITE_ID as string,
            },
          ]
        : []),
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <QueryProvider>
          <AuthProvider>
            <TelemetryProvider>
              <ErrorBoundary>
                <ConnectionBanner />
                <ScrollRestoration />
                <Outlet />
              </ErrorBoundary>
            </TelemetryProvider>
          </AuthProvider>
        </QueryProvider>
        <Scripts />
      </body>
    </html>
  );
}
