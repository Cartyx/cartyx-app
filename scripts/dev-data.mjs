import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const infrastructure = process.env.CARTYX_INFRASTRUCTURE_DIR;
if (infrastructure && !isAbsolute(infrastructure)) {
  throw new Error('CARTYX_INFRASTRUCTURE_DIR must be an absolute checkout path');
}
const root = infrastructure ?? resolve(appRoot, '../cartyx-infrastructure');
const entrypoint = resolve(root, 'scripts/dev-data.mjs');
if (!existsSync(entrypoint)) {
  throw new Error(
    `Database infrastructure is missing at ${root}. Check out biozal/cartyx-infrastructure ` +
      'beside cartyx-app, or set CARTYX_INFRASTRUCTURE_DIR to its absolute path. ' +
      'The checkout must include the JanusGraph/Cassandra infrastructure changes.'
  );
}
const result = spawnSync(process.execPath, [entrypoint, ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
