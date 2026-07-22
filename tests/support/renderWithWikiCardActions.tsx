import type { ReactNode } from 'react';
import { WikiCardActionsProvider } from '~/components/wiki/shared/WikiCardActionsProvider';

/**
 * Test wrapper that mounts the WikiCardActionsProvider so any component (or hook)
 * that calls `useWikiCardActions` / `useWikiCardActionsContext` has its required
 * provider ancestor.
 *
 * The provider calls the same query/mutation hooks the cards used to call
 * directly (useCampaign / useTabletopScreens / useGMScreens /
 * useTabletopPlayerState / router), so a test's EXISTING mocks for those hooks
 * flow straight through — no assertion or mock-setup changes needed, just this
 * ancestor. Pass it via the `wrapper` option of `render` / `renderHook`.
 */
export function WikiCardActionsTestWrapper({ children }: { children: ReactNode }) {
  return <WikiCardActionsProvider>{children}</WikiCardActionsProvider>;
}
