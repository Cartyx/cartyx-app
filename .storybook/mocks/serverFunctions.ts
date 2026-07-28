/**
 * Stand-in for every `~/server/**` module in Storybook.
 *
 * Hooks declare server functions as
 *   createServerFn(...).handler(async () => {
 *     const { thing } = await import('~/server/functions/…')
 *   })
 * and a bundler follows that dynamic import even though a story never executes
 * it — dragging mongoose, the MongoDB driver and `@sentry/node-core` into a
 * browser bundle. In the real app the TanStack Start plugin strips server-fn
 * bodies before that can happen, but Storybook deliberately does not run that
 * plugin (see .storybook/vite.config.ts), so the server layer is aliased here.
 *
 * Calling anything here means a story tried to reach the database, which
 * Storybook can never satisfy — so each export throws a message that names
 * itself rather than failing as `undefined is not a function`.
 *
 * The named exports below are the ones CLIENT code imports statically (a
 * dynamic `await import()` destructures the namespace at runtime and needs no
 * static export). If a new static client→server import appears, this build
 * fails with `"<name>" is not exported by …` — a loud, self-describing failure.
 * Add the name here when that happens.
 */

function unavailable(name: string) {
  return () => {
    throw new Error(
      `Storybook: server function "${name}" was called. Stories run in the ` +
        `browser with no database — mock the hook that wraps it (see ` +
        `.storybook/mocks/) or pass the data in as a prop.`
    );
  };
}

// ~/server/functions/rpc + ~/server/functions/health
export const healthCheck = unavailable('healthCheck');
export const getMe = unavailable('getMe');
export const listCampaigns = unavailable('listCampaigns');
export const getCampaign = unavailable('getCampaign');
// ~/server/db/policy
export const resolveEnvironment = unavailable('resolveEnvironment');
// ~/server/session
export const setSession = unavailable('setSession');
export const getSession = unavailable('getSession');
// ~/server/utils/telemetry — these are no-ops in the app when unconfigured, so
// they stay no-ops here rather than throwing.
export const serverCaptureException = () => {};
export const serverCaptureEvent = () => {};

const namespace = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === '__esModule' || typeof prop === 'symbol') return undefined;
      return unavailable(String(prop));
    },
  }
);

export default namespace;
