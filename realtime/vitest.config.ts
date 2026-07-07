// Required even though vitest's defaults would normally discover src/**/*.test.ts:
// when run from realtime/, vitest resolves the repo root's config (unit/storybook
// projects with include tests/**), so without this local config no tests are found.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
