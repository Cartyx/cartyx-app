import { defineConfig } from 'vitest/config';
import tsConfigPaths from 'vite-tsconfig-paths';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [tsConfigPaths()],
  resolve: {
    alias: {
      '~': path.resolve(__dirname, 'app'),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['app/**/*.{ts,tsx}'],
      exclude: ['app/routes/__root.tsx', 'app/client.tsx', 'app/ssr.tsx', 'app/router.tsx'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'happy-dom',
          globals: true,
          setupFiles: ['./tests/setup.ts'],
          include: ['tests/**/*.test.{ts,tsx}'],
          exclude: ['node_modules/**'],
        },
      },
      {
        // Real-browser tests for code that is NOT a component and must not be
        // dressed as one to get a browser. `app/lib/soundboard/engine.ts` is
        // the first: Web Audio does not exist in happy-dom, and mocking it
        // would make the suite green while measuring nothing.
        //
        // A `*.stories.tsx` under `app/lib/` would NOT have worked — the
        // storybook project collects `.storybook/main.ts`'s
        // `../app/components/**/*.stories.@(ts|tsx)` only, so such a file is
        // never collected and `test:storybook` would exit 0 having run zero
        // assertions.
        //
        // `setupFiles: []` is deliberate: the root `tests/setup.ts` mocks
        // mongoose, which is irrelevant here and pulls node-only modules into
        // a browser bundle.
        extends: true,
        test: {
          name: 'browser',
          include: ['app/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
          setupFiles: [],
        },
      },
      {
        extends: true,
        plugins: [storybookTest({ configDir: path.join(__dirname, '.storybook') })],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
          setupFiles: [],
        },
      },
    ],
  },
});
