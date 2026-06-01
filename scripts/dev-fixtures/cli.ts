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
  cleanE2eArtifacts,
  connectMongo,
  destroyCampaigns,
  disconnectMongo,
  findGm,
  FIXTURE_MARKER,
  sweepOrphanR2Keys,
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
  /**
   * Optional hook for cleanup that lives OUTSIDE the campaign-scoped
   * collection walk (custom Users, global Tags, R2 keys with unusual
   * prefixes, etc.). Called after destroyCampaigns finishes during
   * `fixture destroy <name>` and `fixture destroy --all`. Pure no-op if
   * the fixture only ever creates campaign-scoped data — the generic
   * destroyer already handles that case.
   */
  teardown?(ctx: FixtureContext): Promise<void>;
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

    // Invoke per-fixture teardown hooks for everything we just destroyed
    // (or all of them if --all). Lets fixtures clean up data that lives
    // outside the campaign-scoped collection walk.
    const toTearDown: Fixture[] = args.all ? FIXTURES : args.name ? [findFixture(args.name)] : [];
    if (toTearDown.length > 0) {
      const gm = await findGm(conn);
      for (const fixture of toTearDown) {
        if (!fixture.teardown) continue;
        console.log(`[destroy] running ${fixture.name}.teardown()`);
        await fixture.teardown({ conn, gm, marker: makeMarker });
      }
    }
  } finally {
    await disconnectMongo();
  }
}

async function cmdCleanE2e(): Promise<void> {
  const conn = await connectMongo();
  try {
    const r = await cleanE2eArtifacts(conn);
    console.log(`[clean-e2e] removed ${r.screensDeleted} E2E test screen(s)`);
    console.log(
      `[clean-e2e] pulled ${r.imagesPulled} E2E image(s) from ${r.locationsTouched} location(s)`
    );
    if (r.r2KeysDeleted) console.log(`[clean-e2e] R2 keys deleted: ${r.r2KeysDeleted}`);
  } finally {
    await disconnectMongo();
  }
}

async function cmdSweepR2(): Promise<void> {
  const conn = await connectMongo();
  try {
    const r = await sweepOrphanR2Keys(conn);
    if (r.skippedNoR2) {
      console.log('[sweep-r2] R2 not configured — skipping.');
      return;
    }
    console.log(
      `[sweep-r2] inspected ${r.inspected} keys, ${r.inUse} in-use, deleted ${r.orphansDeleted} orphan(s), failed ${r.orphansFailed}`
    );
  } finally {
    await disconnectMongo();
  }
}

async function cmdNuke(): Promise<void> {
  // Full teardown: every fixture-managed campaign + E2E artefacts + orphan
  // R2 keys. The "rebuild from scratch with no migration worries" path.
  console.log('[nuke] step 1/3 — destroying all fixture-managed campaigns');
  await cmdDestroy({ all: true });
  console.log('\n[nuke] step 2/3 — cleaning E2E artefacts');
  await cmdCleanE2e();
  console.log('\n[nuke] step 3/3 — sweeping orphan R2 keys');
  await cmdSweepR2();
  console.log('\n[nuke] ✓ dev DB and R2 bucket are clean of fixture/test data.');
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
    case 'clean-e2e':
      await cmdCleanE2e();
      return;
    case 'sweep-r2':
      await cmdSweepR2();
      return;
    case 'nuke':
      await cmdNuke();
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
          `  npm run fixture destroy --id=<campaignId> --force\n` +
          `  npm run fixture clean-e2e        # remove E2E test screen + e2e/* image refs\n` +
          `  npm run fixture sweep-r2         # delete R2 objects no doc references\n` +
          `  npm run fixture nuke             # destroy --all + clean-e2e + sweep-r2\n`
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
