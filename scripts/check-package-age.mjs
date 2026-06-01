#!/usr/bin/env node
/**
 * Supply-chain defence: fail if any **direct** dep was installed at a
 * version published within the last N days. Pairs with the `cooldown` block
 * in `.github/dependabot.yml`, which prevents Dependabot from opening PRs
 * for freshly-published versions. This script catches the manual
 * `npm install foo@latest` path.
 *
 * Only direct deps (package.json `dependencies` + `devDependencies`) are
 * gated, because:
 *   - That's the surface where a maintainer-compromise attack actually
 *     reaches our code (we explicitly chose to depend on them).
 *   - Transitives churn at very high velocity (eg. @babel/* publishes
 *     daily) and we don't control them — gating on transitives would
 *     break CI almost continuously without a real security upside.
 *
 * Set STRICT_AGE_CHECK=1 to also fail on too-new transitives (still useful
 * as a periodic audit, just impractical as a default CI gate).
 *
 * Usage:
 *   node scripts/check-package-age.mjs              # defaults to MIN_AGE_DAYS=10
 *   MIN_AGE_DAYS=14 node scripts/check-package-age.mjs
 *   STRICT_AGE_CHECK=1 node scripts/check-package-age.mjs   # also gate transitives
 *   SKIP_AGE_CHECK=1 node scripts/check-package-age.mjs     # emergency bypass
 *
 * Reads `package-lock.json` directly (no node_modules needed). Queries the
 * npm registry once per unique package name and looks up each pinned
 * version's publish timestamp from the `time` map. Concurrency-limited so
 * we don't hammer the registry.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCKFILE = resolve(__dirname, '..', 'package-lock.json');
const MIN_AGE_DAYS = Number(process.env.MIN_AGE_DAYS ?? 10);
const CONCURRENCY = Number(process.env.AGE_CHECK_CONCURRENCY ?? 16);
const REGISTRY = (process.env.NPM_REGISTRY ?? 'https://registry.npmjs.org').replace(/\/+$/, '');

if (process.env.SKIP_AGE_CHECK === '1') {
  console.warn('[check-package-age] SKIP_AGE_CHECK=1 — bypassing age check.');
  process.exit(0);
}

if (!Number.isFinite(MIN_AGE_DAYS) || MIN_AGE_DAYS < 0) {
  console.error(`[check-package-age] Invalid MIN_AGE_DAYS=${process.env.MIN_AGE_DAYS}`);
  process.exit(2);
}

if (!Number.isInteger(CONCURRENCY) || CONCURRENCY < 1) {
  console.error(
    `[check-package-age] Invalid AGE_CHECK_CONCURRENCY=${process.env.AGE_CHECK_CONCURRENCY} (expected a positive integer)`
  );
  process.exit(2);
}

const thresholdMs = Date.now() - MIN_AGE_DAYS * 24 * 60 * 60 * 1000;
const threshold = new Date(thresholdMs).toISOString();

/**
 * @returns {Promise<{ versions: Map<string, Set<string>>, directNames: Set<string> }>}
 *   `versions` — every (name, version) pair in the resolved tree
 *   `directNames` — names listed in package.json dependencies/devDependencies
 */
async function loadLockfile() {
  const raw = await readFile(LOCKFILE, 'utf8');
  const lock = JSON.parse(raw);
  if (lock.lockfileVersion < 2) {
    throw new Error(`Unsupported lockfileVersion=${lock.lockfileVersion}; expected v2 or v3.`);
  }
  const versions = new Map();
  const root = lock.packages?.[''] ?? {};
  const directNames = new Set([
    ...Object.keys(root.dependencies ?? {}),
    ...Object.keys(root.devDependencies ?? {}),
  ]);
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (!path || path === '') continue; // root package
    if (entry.link) continue; // workspace / link:
    const resolvedUrl = entry.resolved ?? '';
    if (!resolvedUrl.startsWith('https://')) continue; // file:, git+, link:, no resolved
    if (!entry.version) continue;
    if (entry.version.startsWith('file:') || entry.version.startsWith('link:')) continue;
    const name = pathToPackageName(path);
    if (!name) continue;
    if (!versions.has(name)) versions.set(name, new Set());
    versions.get(name).add(entry.version);
  }
  return { versions, directNames };
}

/** Convert lockfile key like `node_modules/foo/node_modules/@scope/bar` → `@scope/bar`. */
function pathToPackageName(key) {
  const idx = key.lastIndexOf('node_modules/');
  if (idx < 0) return null;
  const tail = key.slice(idx + 'node_modules/'.length);
  return tail || null;
}

/** Async pool: run `fn` over `items` with bounded concurrency. */
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        results[i] = await fn(items[i], i);
      }
    })
  );
  return results;
}

/**
 * Fetch the published-time map for a package. Returns null on any error so a
 * registry hiccup doesn't block the build — failing-open here is the right
 * trade because the dependabot cooldown layer already gives belt-and-braces.
 */
async function fetchPackageTimes(name) {
  // Full packument required for the `time` map; abbreviated format omits it.
  const url = `${REGISTRY}/${encodeURIComponent(name).replace('%40', '@')}`;
  try {
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) {
      return { ok: false, error: `HTTP ${resp.status}` };
    }
    const body = await resp.json();
    return { ok: true, times: body.time ?? {} };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  const strict = process.env.STRICT_AGE_CHECK === '1';
  console.log(
    `[check-package-age] threshold: published before ${threshold} (MIN_AGE_DAYS=${MIN_AGE_DAYS}, mode=${strict ? 'strict (all deps)' : 'direct deps only'})`
  );

  const { versions: versionMap, directNames } = await loadLockfile();
  const names = [...versionMap.keys()].sort();
  console.log(
    `[check-package-age] inspecting ${names.length} unique packages (${directNames.size} direct)...`
  );

  /** @type {Array<{name: string, version: string, publishedAt: string, direct: boolean}>} */
  const tooNew = [];
  const fetchErrors = [];
  let inspected = 0;

  await pool(names, CONCURRENCY, async (name) => {
    const result = await fetchPackageTimes(name);
    if (!result.ok) {
      fetchErrors.push({ name, error: result.error });
      return;
    }
    for (const version of versionMap.get(name)) {
      const publishTime = result.times[version];
      if (!publishTime) continue;
      if (Date.parse(publishTime) > thresholdMs) {
        tooNew.push({ name, version, publishedAt: publishTime, direct: directNames.has(name) });
      }
      inspected++;
    }
  });

  console.log(`[check-package-age] checked ${inspected} (name, version) pairs`);

  if (fetchErrors.length > 0) {
    console.warn(
      `[check-package-age] ${fetchErrors.length} registry fetch errors (treated as pass):`
    );
    for (const e of fetchErrors.slice(0, 10)) {
      console.warn(`  - ${e.name}: ${e.error}`);
    }
    if (fetchErrors.length > 10) console.warn(`  ... and ${fetchErrors.length - 10} more`);
  }

  tooNew.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const directTooNew = tooNew.filter((p) => p.direct);
  const transitiveTooNew = tooNew.filter((p) => !p.direct);

  // Always surface transitive churn as a soft signal — useful context, never blocks.
  if (transitiveTooNew.length > 0) {
    console.log(
      `[check-package-age] ℹ ${transitiveTooNew.length} transitive dep(s) published in last ${MIN_AGE_DAYS} days (informational):`
    );
    for (const p of transitiveTooNew.slice(0, 5)) {
      console.log(`  - ${p.name}@${p.version}  (${p.publishedAt})`);
    }
    if (transitiveTooNew.length > 5) {
      console.log(`  ... and ${transitiveTooNew.length - 5} more`);
    }
  }

  const failing = strict ? tooNew : directTooNew;
  if (failing.length === 0) {
    console.log('[check-package-age] ✓ no direct deps newer than threshold');
    return;
  }

  console.error('');
  console.error(
    `[check-package-age] ✗ ${failing.length} ${strict ? 'package' : 'direct dep'} version(s) were published less than ${MIN_AGE_DAYS} days ago:`
  );
  for (const p of failing) {
    const tag = p.direct ? 'direct' : 'transitive';
    console.error(`  - ${p.name}@${p.version}  [${tag}]  (published ${p.publishedAt})`);
  }
  console.error('');
  console.error(
    'If you intentionally accept the risk (e.g. urgent CVE fix), set SKIP_AGE_CHECK=1 for this run and document why in the PR.'
  );
  process.exit(1);
}

await main().catch((err) => {
  console.error(`[check-package-age] unexpected failure: ${err?.stack ?? err}`);
  process.exit(2);
});
