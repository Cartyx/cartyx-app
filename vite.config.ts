import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { nitro } from 'nitro/vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import tsConfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [
    tsConfigPaths(),
    nitro({
      // mongodb >=7.2 resolves crypto/os/etc. with lazy CommonJS require()
      // calls that throw "require is not defined" when the driver is bundled
      // into the ESM server output. Trace the DB stack as an external CJS
      // dependency instead of bundling it.
      traceDeps: ['mongoose', 'mongodb', 'bson'],
    }),
    tanstackStart({
      srcDirectory: 'app',
    }),
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler', {}]],
      },
    }),
    tailwindcss(),
  ],
});
