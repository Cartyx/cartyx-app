import type { ReactNode } from 'react';
import {
  WikiCardActionsContext,
  type WikiCardActionsContextValue,
} from '~/components/wiki/shared/WikiCardActionsProvider';

/**
 * Supplies a fixed wiki-card-actions context WITHOUT the router or React Query.
 *
 * The real `WikiCardActionsProvider` reads
 * `useParams({ from: '/campaigns/$campaignId/play' })` plus five query hooks, so
 * it cannot mount outside that route — which makes it unusable in Storybook.
 * Any story rendering a component that reaches `useWikiCardActions` (a wiki or
 * note card, or the `ShowOnTabletopButton` in a view-modal header) needs this
 * decorator, or the context hook throws and the story fails to render.
 *
 * Defaults to a GM on the Tabletop so menus render with every action visible;
 * pass `value` to override individual fields.
 */

const noop = () => {};

const DEFAULT_VALUE: WikiCardActionsContextValue = {
  campaignId: 'storybook-campaign',
  isGM: true,
  surface: 'tabletop',
  tabletopScreenId: 'storybook-screen',
  gmScreenId: 'storybook-gm-screen',
  privateWindows: [],
  tabletopSharedWindows: [],
  gmSharedWindows: [],
  openWindowMutate: noop as unknown as WikiCardActionsContextValue['openWindowMutate'],
  addPrivateWindowMutate: noop as unknown as WikiCardActionsContextValue['addPrivateWindowMutate'],
  focusExistingWindow: noop,
};

export function WikiCardActionsStubProvider({
  children,
  value,
}: {
  children: ReactNode;
  value?: Partial<WikiCardActionsContextValue>;
}) {
  return (
    <WikiCardActionsContext.Provider value={{ ...DEFAULT_VALUE, ...value }}>
      {children}
    </WikiCardActionsContext.Provider>
  );
}
