import React from 'react';

// Re-export everything from the real @tanstack/react-router using a direct
// file path so Vite's alias (which rewrites the bare specifier to this mock)
// doesn't cause a circular import.
export * from '../../node_modules/@tanstack/react-router/dist/esm/index.js';

// Override Link with a plain <a> so Storybook stories render without a
// RouterProvider context.
export type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  to?: string;
  children?: React.ReactNode;
  className?: string;
};

export function Link({ to, children, ...props }: LinkProps) {
  return (
    <a href={to} {...props}>
      {children}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Route-context hooks
// ---------------------------------------------------------------------------
//
// The real hooks read router context and throw
// "Cannot read properties of null (reading 'stores')" when no RouterProvider is
// mounted. Every panel under the play route calls
// `useParams({ from: '/campaigns/$campaignId/play' })` at the top of its body —
// WikiPanel, NotesPanel, SettingsPanel, ChatPanel — so without these overrides
// any story rendering one fails outright, including the ones that reach them
// indirectly (InspectorSidebar and MainView mount every tab panel at once).
//
// Standing up a real memory-history router for stories would mean registering
// the route tree and its loaders, which drags the server layer back into the
// bundle. Stories only need the params to be *present*, so fixed values are the
// honest fixture. MOCK_CAMPAIGN_ID matches the id used by ./useGMScreens.ts and
// ./useNotes.ts so the mocked data lines up.

export const MOCK_CAMPAIGN_ID = 'camp-1';

export function useParams(_opts?: unknown): Record<string, string> {
  return { campaignId: MOCK_CAMPAIGN_ID };
}

export function useSearch(_opts?: unknown): Record<string, unknown> {
  return { tab: 'tabletop' };
}

export function useNavigate(): (..._args: unknown[]) => void {
  return () => {};
}
