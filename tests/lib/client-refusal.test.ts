import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  isClientRefusal,
  AUDIO_CLIENT_ERROR_NAME,
  PACKAGE_CLIENT_ERROR_NAME,
  SOUNDBOARD_CLIENT_ERROR_NAME,
} from '~/lib/client-refusal';
import { PACKAGE_STALE_WRITE_ERROR_NAME } from '~/lib/soundboard/stale-write';

/**
 * A refusal crosses the wire as a plain `Error` carrying the server class's
 * `name` — seroval does not reconstruct the class, and the class does not
 * exist in the browser anyway. Building the fixtures that way, rather than
 * importing the real classes, is deliberate: a test using real instances would
 * pass against an `instanceof` implementation that cannot work in a browser at
 * all.
 */
function overWire(name: string, message = 'refused'): Error {
  return Object.assign(new Error(message), { name });
}

describe('isClientRefusal', () => {
  it.each([
    ['audio', AUDIO_CLIENT_ERROR_NAME],
    ['package', PACKAGE_CLIENT_ERROR_NAME],
    ['soundboard', SOUNDBOARD_CLIENT_ERROR_NAME],
    // A `PackageClientError` subclass that OVERRIDES `name` — a check on the
    // three base names alone would miss it, which is why it is listed
    // explicitly in the module.
    ['stale package write', PACKAGE_STALE_WRITE_ERROR_NAME],
  ])('recognises a %s refusal', (_label, name) => {
    expect(isClientRefusal(overWire(name))).toBe(true);
  });

  it.each([
    ['a genuine server fault', new Error('502 Bad Gateway')],
    ['a network failure', new TypeError('Failed to fetch')],
    ['a look-alike name', overWire('AudioClientErrorish')],
    ['a non-Error', { name: AUDIO_CLIENT_ERROR_NAME, message: 'not an Error' }],
    ['null', null],
  ])('does not swallow %s', (_label, value) => {
    expect(isClientRefusal(value)).toBe(false);
  });
});

/**
 * THE SWEEP, pinned as source-level assertions rather than behaviour.
 *
 * This is the finding that recurred: the exclusion was applied at the one
 * entry point a task named (`uploadAudio.ts`) while ELEVEN sibling capture
 * sites into the same telemetry resource stayed open — and gating
 * `bulkTagAudioAssetsFn` on a bucket in the same wave newly CREATED one of
 * them. A behavioural test per site would catch none of that, because the
 * twelfth site added next month passes every one of them.
 *
 * So: assert on the files. Every `captureException` on this surface must be
 * guarded by `isClientRefusal`, and a new unguarded one fails here with a
 * message that says what to do. This is the same "cover the surface, not the
 * list" rule the rate-limit buckets already follow.
 */
describe('every capture site on the audio/soundboard surface is guarded', () => {
  const FILES = [
    'app/utils/uploadAudio.ts',
    'app/routes/audio.tsx',
    'app/routes/audio_.packages.tsx',
    'app/routes/audio_.packages_.$packageId.tsx',
    'app/hooks/useSoundboard.ts',
  ];

  /**
   * How far back a guard may sit from the call it protects. The real shapes
   * are same-line (`if (!isClientRefusal(e)) captureException(...)`) and a
   * short `if` block; 8 lines covers both with room for an intervening
   * comment. Deliberately NOT a whole-file `includes` check — that was the
   * first version, and it would pass a file that guards ten call sites and
   * leaves an eleventh open, which is precisely the defect this whole test
   * exists to prevent recurring.
   */
  const GUARD_WINDOW = 8;

  it.each(FILES)('%s guards every captureException it issues', (file) => {
    const lines = readFileSync(join(process.cwd(), file), 'utf8').split('\n');

    // Every CALL — not the import, and not a mention in prose.
    const callSites = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => /\bcaptureException\(/.test(line))
      .filter(({ line }) => {
        const t = line.trimStart();
        return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('import ');
      });

    // The fixture has teeth only if there is something to find.
    expect(callSites.length).toBeGreaterThan(0);

    const unguarded = callSites.filter(
      ({ i }) =>
        !lines
          .slice(Math.max(0, i - GUARD_WINDOW), i + 1)
          .some((l) => l.includes('isClientRefusal('))
    );

    expect(
      unguarded.map(({ i }) => i + 1),
      `${file} calls captureException unguarded. A refusal (quota, ` +
        `pending-job cap, rate limit, not-found, stale write) is a control ` +
        `doing its job, not a fault: the server files no GlitchTip event for ` +
        `it, and neither may the browser. Gate each call with isClientRefusal ` +
        `from ~/lib/client-refusal.`
    ).toEqual([]);
  });
});
