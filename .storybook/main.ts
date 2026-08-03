import type { StorybookConfig } from '@storybook/react-vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  // Explicitly set staticDirs to empty so Storybook doesn't copy public/index.html
  // over the manager's generated index.html.
  staticDirs: [],
  stories: ['../app/components/**/*.stories.@(ts|tsx)'],
  addons: [
    '@chromatic-com/storybook',
    '@storybook/addon-vitest',
    '@storybook/addon-a11y',
    '@storybook/addon-docs',
    '@storybook/addon-onboarding',
  ],
  // Point the builder at .storybook/vite.config.ts instead of letting it
  // auto-load the app's root vite.config.ts, which carries the nitro/start
  // server plugins that break the preview build. See that file for the detail.
  framework: {
    name: '@storybook/react-vite',
    options: {
      builder: {
        viteConfigPath: '.storybook/vite.config.ts',
      },
    },
  },
  viteFinal: async (config, { configType: _configType }) => {
    // The server plugins are no longer inherited at all — see the `framework`
    // block above and .storybook/vite.config.ts. All that is left here is the
    // Storybook-only aliasing.
    config.plugins = config.plugins ?? [];
    config.plugins.push(tsconfigPaths());
    config.resolve = config.resolve ?? {};
    // Use array format for aliases so we can use exact-match regex.
    // A plain string alias for '@tanstack/react-router' also catches
    // subpath imports like '@tanstack/react-router/ssr/server', breaking
    // TanStack Start internals. The regex anchors with $ to match only
    // the bare specifier.
    const existingAlias = config.resolve.alias ?? {};
    const aliasArray = Array.isArray(existingAlias)
      ? existingAlias
      : Object.entries(existingAlias).map(([find, replacement]) => ({ find, replacement }));
    aliasArray.push(
      // Every `~/server/**` module collapses to one inert stub. Without this the
      // server-function dynamic imports inside hooks pull mongoose, the MongoDB
      // driver and @sentry/node-core into the browser bundle and the preview
      // build fails outright. See ./mocks/serverFunctions.ts.
      {
        find: /^~\/server\/.*$/,
        replacement: path.resolve(__dirname, './mocks/serverFunctions.ts'),
      },
      // Server-only despite living under `app/lib/`, so the `~/server/**`
      // pattern above misses it: it reads `process.env` at module scope and is
      // statically reachable from AudioUploadDropzone's story through
      // ~/utils/uploadAudio -> ~/utils/audio-server-fns. The real client build
      // strips the handler bodies that reference it and drops the module; the
      // Storybook build does not. See ./mocks/audioRateLimits.ts.
      {
        find: /^~\/lib\/audio-rate-limits$/,
        replacement: path.resolve(__dirname, './mocks/audioRateLimits.ts'),
      },
      // Reaches node:async_hooks via @tanstack/start-storage-context, which a
      // browser bundle cannot resolve. See ./mocks/react-start.ts.
      {
        find: /^@tanstack\/react-start$/,
        replacement: path.resolve(__dirname, './mocks/react-start.ts'),
      },
      {
        find: /^@tanstack\/react-router$/,
        replacement: path.resolve(__dirname, './mocks/router.tsx'),
      },
      { find: '~/hooks/useAuth', replacement: path.resolve(__dirname, './mocks/useAuth.ts') },
      { find: '~/hooks/useNotes', replacement: path.resolve(__dirname, './mocks/useNotes.ts') },
      {
        find: '~/hooks/useGMScreens',
        replacement: path.resolve(__dirname, './mocks/useGMScreens.ts'),
      }
    );
    config.resolve.alias = aliasArray;
    return config;
  },
};
export default config;
