import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUDIO_MAX_BYTES } from '~/types/audio';
import { AUDIO_STORAGE_PREFIX_RE, audioUserRoot } from '~/server/functions/audio-storage';

/**
 * Constants the web app and `audio-worker/` BOTH depend on, checked against the
 * worker's actual source text.
 *
 * WHY NOT A SHARED MODULE
 * -----------------------
 * The two packages are deliberately independent: separate `package.json`,
 * separate lockfile, separate tsconfig, and `audio-worker/Dockerfile` copies
 * only `audio-worker/src` into its build context. A shared import would mean
 * an npm workspace or copying app files into the worker's Docker context — a
 * standing coupling, paid on every build, to protect three numbers. The
 * independence is a feature: the worker is a queue consumer that must be
 * deployable and restartable without the web app.
 *
 * What the duplication actually costs is not the copy, it is that the copy can
 * drift SILENTLY. So this closes the silence rather than the duplication: it
 * reads the worker's source from disk (both packages live in this repo, and CI
 * checks out the whole thing) and fails the moment the values disagree. No
 * runtime dependency in either direction, and no `--project` or Docker context
 * changes. Each side also keeps a comment naming the other.
 *
 * If the packages are ever split into separate repositories this test stops
 * being possible, and that is the point at which a shared published package
 * becomes worth its cost.
 */

const WORKER_SRC = join(process.cwd(), 'audio-worker', 'src');

function workerSource(file: string): string {
  return readFileSync(join(WORKER_SRC, file), 'utf8');
}

/**
 * Evaluates the simple `a * b * c` products these constants are written as,
 * without `eval`. Anything more complicated is a deliberate failure: the point
 * is to compare values, and an expression this can't read is one a human
 * should look at.
 */
function productLiteral(expr: string): number {
  const cleaned = expr.replace(/_/g, '').replace(/\s/g, '');
  if (!/^\d+(\*\d+)*$/.test(cleaned)) {
    throw new Error(`Not a plain numeric product, read it by hand: ${expr}`);
  }
  return cleaned.split('*').reduce((acc, n) => acc * Number(n), 1);
}

describe('audio size cap, app vs worker', () => {
  /**
   * The cap is enforced twice on purpose, and the second one is the real one.
   * `confirmAudioUpload`'s `HeadObject` measures the object at confirm time,
   * but the presigned PUT stays valid for 300 s and is REUSABLE — a client can
   * PUT 1 KB, let confirm pass, then re-PUT gigabytes to the same URL. So the
   * worker re-measures while streaming (`maxSourceBytes`), and it is that
   * number which decides whether a 768Mi pod survives the download.
   *
   * Drift in either direction is a real failure, not a cosmetic one: a worker
   * cap BELOW the app's rejects uploads the app promised to accept, after the
   * user has already waited for the upload; a worker cap ABOVE the app's
   * reopens exactly the TOCTOU hole the streaming guard exists to close.
   */
  it('is the same number in both packages', () => {
    const src = workerSource('config.ts');
    const match = /export const DEFAULT_MAX_SOURCE_BYTES = ([^;]+);/.exec(src);
    expect(match, 'DEFAULT_MAX_SOURCE_BYTES not found in audio-worker/src/config.ts').toBeTruthy();
    expect(productLiteral(match![1])).toBe(AUDIO_MAX_BYTES);
  });

  it('is still 50 MB, so a change on either side is a deliberate one', () => {
    expect(AUDIO_MAX_BYTES).toBe(50 * 1024 * 1024);
  });
});

describe('audio storage key layout, app vs worker', () => {
  /**
   * The app mints source keys; the worker parses the owner's namespace back out
   * of them to decide where renditions go, and permanently fails any key it
   * cannot parse. A prefix shape change on the app side that the worker's
   * regex does not accept therefore fails EVERY upload — and it would fail it
   * in production, since neither package's own tests can see the other's
   * literal.
   */
  it('lets the worker parse a key the app just minted', () => {
    const src = workerSource('keys.ts');
    const match = /const STORAGE_PREFIX_RE = (\/.+\/);/.exec(src);
    expect(match, 'STORAGE_PREFIX_RE not found in audio-worker/src/keys.ts').toBeTruthy();

    const body = match![1].slice(1, -1);
    const workerRe = new RegExp(body);

    // A prefix of exactly the shape the app mints (see `resolveAudioStoragePrefix`).
    const prefix = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    expect(prefix).toMatch(AUDIO_STORAGE_PREFIX_RE);

    const key = `${audioUserRoot(prefix)}1700000000000-deadbeef.wav`;
    expect(workerRe.exec(key)?.[1]).toBe(prefix);
  });

  /**
   * The other half of the layout: the app's cleanup lists
   * `uploads/audio/<prefix>/` and reclaims whatever no row references, so a
   * rendition the worker writes outside that root is invisible to its own
   * owner forever. Pinned against the worker's builder, not restated.
   */
  it('keeps the worker’s rendition keys inside the root the app lists', () => {
    const src = workerSource('keys.ts');
    expect(src).toContain('`uploads/audio/${prefix}/renditions/${assetId}`');

    const prefix = '0123456789abcdef0123456789abcdef';
    expect(`uploads/audio/${prefix}/renditions/abc`.startsWith(audioUserRoot(prefix))).toBe(true);
  });
});
