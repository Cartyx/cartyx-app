/**
 * Stand-in for `@tanstack/react-start` in Storybook.
 *
 * The real module reaches `@tanstack/start-storage-context`, which imports
 * `node:async_hooks` — unresolvable in a browser bundle, and fatal to the
 * preview build ("AsyncLocalStorage is not exported by __vite-browser-external").
 * In the app the Start vite plugin handles this; Storybook deliberately does not
 * run that plugin (see .storybook/vite.config.ts).
 *
 * Only `createServerFn` and `createMiddleware` are imported anywhere in `app/`,
 * and both exist purely to define server endpoints — so the builder chain is
 * reproduced here and the resulting endpoint throws a clear message if a story
 * ever calls it. Pair this with the `~/server/**` alias, which keeps the handler
 * bodies (and therefore mongoose) out of the bundle entirely.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

function unavailable(kind: string) {
  return async () => {
    throw new Error(
      `Storybook: a ${kind} was invoked. Stories run in the browser with no ` +
        `server — mock the hook that wraps it (see .storybook/mocks/) or pass ` +
        `the data in as a prop.`
    );
  };
}

function builder(kind: string): any {
  const chain: any = {
    inputValidator: () => chain,
    validator: () => chain,
    middleware: () => chain,
    client: () => chain,
    server: () => chain,
    handler: () => unavailable(kind),
  };
  return chain;
}

export function createServerFn(_options?: unknown): any {
  return builder('server function');
}

export function createMiddleware(_options?: unknown): any {
  return builder('middleware');
}
