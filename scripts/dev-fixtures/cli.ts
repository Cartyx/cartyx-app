#!/usr/bin/env node
/**
 * Dev fixtures CLI.
 *
 * Usage:
 *   npm run fixture list
 *   npm run fixture reset <fixture-name>
 *   npm run fixture destroy <fixture-name>
 *   npm run fixture destroy --all
 *
 * Or directly:
 *   tsx scripts/dev-fixtures/cli.ts <subcommand> [args]
 *
 * Safety: refuses to run if NODE_ENV=production or MONGODB_URI looks prod.
 * Only ever destroys campaigns tagged with `metadata.managedBy`, never your
 * real campaigns. Pass `--force` to destroy by campaign id.
 */
import {
  connectMongo,
  disconnectMongo,
  destroyCampaigns,
  findGm,
  FIXTURE_MARKER,
  type FixtureMetadata,
} from './helpers';
import { crowdedFixture } from './fixtures/crowded';
import { kankaFixture } from './fixtures/kanka';
import type { Connection } from 'mongoose';
import type { ObjectId } from 'mongodb';

// ---------------------------------------------------------------------------
// Fixture interface
// ---------------------------------------------------------------------------

export interface FixtureContext {
  conn: Connection;
  gm: { _id: ObjectId; providerId?: string };
  /** Stamp this metadata on the campaign documents you create. */
  marker(fixtureName: string): FixtureMetadata;
}

export interface Fixture {
  name: string;
  description: string;
  seed(ctx: FixtureContext): Promise<{ campaignIds: ObjectId[] }>;
}

const FIXTURES: Fixture[] = [crowdedFixture, kankaFixture];

function findFixture(name: string): Fixture {
  const f = FIXTURES.find((x) => x.name === name);
  if (!f) {
    const available = FIXTURES.map((x) => x.name).join(', ');
    throw new Error(`Unknown fixture "${name}". Available: ${available}`);
  }
  return f;
}

function makeMarker(fixtureName: string): FixtureMetadata {
  return {
    managedBy: FIXTURE_MARKER.managedBy,
    fixtureName,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function cmdList(): Promise<void> {
  console.log('Available fixtures:');
  for (const f of FIXTURES) {
    console.log(`  ${f.name.padEnd(12)} — ${f.description}`);
  }
}

async function cmdReset(name: string): Promise<void> {
  const fixture = findFixture(name);
  const conn = await connectMongo();
  try {
    console.log(
      `[fixture:reset ${name}] destroying existing fixture-managed campaigns of this name...`
    );
    const destroyed = await destroyCampaigns(conn, { fixtureName: name });
    logDestroy(destroyed);

    console.log(`[fixture:reset ${name}] seeding fresh data...`);
    const gm = await findGm(conn);
    const { campaignIds } = await fixture.seed({ conn, gm, marker: makeMarker });
    console.log(`[fixture:reset ${name}] ✓ created ${campaignIds.length} campaign(s):`);
    for (const id of campaignIds) console.log(`    ${id.toString()}`);
  } finally {
    await disconnectMongo();
  }
}

async function cmdDestroy(args: {
  name?: string;
  all?: boolean;
  campaignId?: string;
  force?: boolean;
}): Promise<void> {
  if (!args.name && !args.all && !args.campaignId) {
    throw new Error('destroy requires <fixture-name>, --all, or --id=<campaignId>');
  }
  const conn = await connectMongo();
  try {
    const result = await destroyCampaigns(conn, {
      fixtureName: args.name,
      campaignId: args.campaignId,
      allFixtures: args.all,
      force: args.force,
    });
    logDestroy(result);
  } finally {
    await disconnectMongo();
  }
}

function logDestroy(result: Awaited<ReturnType<typeof destroyCampaigns>>): void {
  console.log(`[destroy] removed ${result.campaignsDeleted} campaign(s)`);
  for (const [coll, n] of Object.entries(result.collectionsDeleted)) {
    console.log(`    ${coll.padEnd(22)} ${n}`);
  }
  if (result.r2KeysDeleted || result.r2KeysFailed) {
    console.log(`    R2 keys deleted: ${result.r2KeysDeleted}  failed: ${result.r2KeysFailed}`);
  }
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const [command, ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (const arg of rest) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq >= 0) flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      else flags[arg.slice(2)] = true;
    } else {
      positional.push(arg);
    }
  }
  return { command: command ?? '', positional, flags };
}

async function main(): Promise<void> {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));

  switch (command) {
    case 'list':
      await cmdList();
      return;
    case 'reset':
      if (!positional[0])
        throw new Error('reset requires a fixture name. Try `npm run fixture list`.');
      await cmdReset(positional[0]);
      return;
    case 'destroy':
      await cmdDestroy({
        name: positional[0],
        all: flags.all === true,
        campaignId: typeof flags.id === 'string' ? flags.id : undefined,
        force: flags.force === true,
      });
      return;
    case '':
    case 'help':
    case '--help':
    case '-h':
      console.log(
        `Usage:\n` +
          `  npm run fixture list\n` +
          `  npm run fixture reset <name>\n` +
          `  npm run fixture destroy <name>\n` +
          `  npm run fixture destroy --all\n` +
          `  npm run fixture destroy --id=<campaignId> --force\n`
      );
      return;
    default:
      throw new Error(`Unknown command "${command}". Try \`npm run fixture help\`.`);
  }
}

main().catch((err) => {
  console.error(`[fixture] ✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
  // Best-effort disconnect in case we failed mid-flight
  disconnectMongo().catch(() => undefined);
});
