import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import tsConfigPaths from 'vite-tsconfig-paths';

/**
 * Vite config used ONLY by Storybook (wired via `viteConfigPath` in main.ts).
 *
 * Storybook's react-vite builder auto-loads the project's root `vite.config.ts`
 * unless told otherwise — and that config includes `nitro()` and
 * `tanstackStart()`, whose plugins break the Storybook preview build:
 *
 *   - `tanstack-start:start-manifest-capture-client-build` aborts with
 *     "multiple entries detected" because Storybook adds its own entry
 *   - the start router plugin throws "Cannot get config before root is resolved"
 *   - server entrypoints (`#tanstack-router-entry`, `#tanstack-start-entry`,
 *     `tanstack-start-manifest:v`) are unresolvable in a browser bundle
 *
 * main.ts previously tried to strip those by plugin-name prefix, but both
 * factories return NESTED arrays of plugins, so the top-level filter matched
 * nothing. Name-prefix filtering is fragile anyway — it silently stops working
 * whenever an upstream plugin is renamed or reorganised. Declaring the small set
 * of plugins Storybook actually needs is the durable fix.
 *
 * Stories are pure client components, so this is genuinely all they need:
 * JSX/Fast-Refresh, Tailwind (preview.ts imports `app/styles/globals.css`, which
 * is inert without it), and the `~/*` path aliases.
 */
export default defineConfig({
  plugins: [tsConfigPaths(), react(), tailwindcss()],
});
