import { describe, it, expect, vi, beforeEach } from 'vitest';

// `findById(...).select(...).lean()` and `findOneAndUpdate(...).select(...).lean()`.
const findByIdLean = vi.fn();
const findByIdSelect = vi.fn(() => ({ lean: findByIdLean }));
const findById = vi.fn(() => ({ select: findByIdSelect }));

const updateLean = vi.fn();
const updateSelect = vi.fn(() => ({ lean: updateLean }));
const findOneAndUpdate = vi.fn(() => ({ select: updateSelect }));

vi.mock('~/server/db/models/User', () => ({ User: { findById, findOneAndUpdate } }));

const USER = '507f1f77bcf86cd799439011';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('audioUserRoot / assertStoragePrefix', () => {
  it('builds the namespace root for a well-formed prefix', async () => {
    const { audioUserRoot } = await import('~/server/functions/audio-storage');
    expect(audioUserRoot('a1b2c3d4e5f60718293a4b5c6d7e8f90')).toBe(
      'uploads/audio/a1b2c3d4e5f60718293a4b5c6d7e8f90/'
    );
  });

  /**
   * The key builders fail closed. Every one of these values, silently accepted,
   * mints an object OUTSIDE any user's listing prefix — unreclaimable in
   * exactly the way the per-user layout exists to prevent — and the `../` and
   * `/`-bearing ones land inside somebody else's namespace instead.
   */
  it.each([
    ['', 'empty'],
    ['undefined', 'a stringified undefined'],
    ['../0123456789abcdef0123456789abcdef', 'a traversal'],
    ['a1b2c3d4e5f60718293a4b5c6d7e8f90/renditions', 'a nested path'],
    ['A1B2C3D4E5F60718293A4B5C6D7E8F90', 'uppercase hex'],
    ['a1b2c3d4e5f60718293a4b5c6d7e8f9', '31 characters'],
    ['a1b2c3d4e5f60718293a4b5c6d7e8f900', '33 characters'],
    ['z1b2c3d4e5f60718293a4b5c6d7e8f90', 'a non-hex character'],
  ])('refuses %s (%s)', async (value) => {
    const { audioUserRoot } = await import('~/server/functions/audio-storage');
    expect(() => audioUserRoot(value)).toThrow('Invalid audio storage prefix');
  });
});

describe('resolveAudioStoragePrefix', () => {
  it('returns the stored prefix without writing when the user already has one', async () => {
    findByIdLean.mockResolvedValue({ audioStoragePrefix: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' });

    const { resolveAudioStoragePrefix } = await import('~/server/functions/audio-storage');
    expect(await resolveAudioStoragePrefix(USER)).toBe('a1b2c3d4e5f60718293a4b5c6d7e8f90');
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('mints a 32-hex-character prefix on first use and persists it', async () => {
    findByIdLean.mockResolvedValue({});
    updateLean.mockImplementation(async () => ({
      audioStoragePrefix: (
        findOneAndUpdate.mock.calls[0] as unknown as [unknown, { $set: Record<string, string> }]
      )[1].$set.audioStoragePrefix,
    }));

    const { resolveAudioStoragePrefix, AUDIO_STORAGE_PREFIX_RE } =
      await import('~/server/functions/audio-storage');
    const prefix = await resolveAudioStoragePrefix(USER);

    expect(prefix).toMatch(AUDIO_STORAGE_PREFIX_RE);
    // The shape the worker parses back out of a source key
    // (`audio-worker/src/keys.ts`). A prefix of any other shape would make
    // every rendition key that worker builds fail to resolve.
    expect(prefix).toMatch(/^[0-9a-f]{32}$/);
  });

  /**
   * The prefix is the ONLY path to a user's existing objects, so overwriting it
   * strands their whole library. The `$set` is conditional on the field being
   * absent, which is what makes that impossible even under a concurrent second
   * upload — assert on the filter, because a write that "happens not to
   * overwrite in this test" is not the same as one that cannot.
   */
  it('writes only when no prefix exists, so an existing one can never be replaced', async () => {
    findByIdLean.mockResolvedValue({});
    updateLean.mockResolvedValue({ audioStoragePrefix: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' });

    const { resolveAudioStoragePrefix } = await import('~/server/functions/audio-storage');
    await resolveAudioStoragePrefix(USER);

    const [filter] = findOneAndUpdate.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(filter).toEqual({ _id: USER, audioStoragePrefix: { $in: [null] } });
  });

  /**
   * Two uploads starting at once both see "no prefix" and both try to mint one.
   * The conditional write means only one lands; the loser must return the
   * WINNER's prefix, not the value it generated and failed to store — otherwise
   * it signs an upload URL for a namespace no listing will ever cover.
   */
  it('returns the winner’s prefix when a concurrent request minted one first', async () => {
    findByIdLean
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ audioStoragePrefix: '0123456789abcdef0123456789abcdef' });
    updateLean.mockResolvedValue(null); // conditional filter matched nothing

    const { resolveAudioStoragePrefix } = await import('~/server/functions/audio-storage');
    expect(await resolveAudioStoragePrefix(USER)).toBe('0123456789abcdef0123456789abcdef');
  });

  it('throws rather than inventing a namespace for a user that does not exist', async () => {
    findByIdLean.mockResolvedValue(null);
    const { resolveAudioStoragePrefix } = await import('~/server/functions/audio-storage');
    await expect(resolveAudioStoragePrefix(USER)).rejects.toThrow('User not found');
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('gives two users different namespaces', async () => {
    findByIdLean.mockResolvedValue({});
    updateLean.mockImplementation(async () => {
      const call = findOneAndUpdate.mock.calls.at(-1) as unknown as [
        unknown,
        { $set: Record<string, string> },
      ];
      return { audioStoragePrefix: call[1].$set.audioStoragePrefix };
    });

    const { resolveAudioStoragePrefix } = await import('~/server/functions/audio-storage');
    const a = await resolveAudioStoragePrefix(USER);
    const b = await resolveAudioStoragePrefix('507f1f77bcf86cd799439012');
    expect(a).not.toBe(b);
  });
});

describe('lookupAudioStoragePrefix', () => {
  it('never writes — a scan must not be what mints a namespace', async () => {
    findByIdLean.mockResolvedValue({});
    const { lookupAudioStoragePrefix } = await import('~/server/functions/audio-storage');
    expect(await lookupAudioStoragePrefix(USER)).toBeNull();
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns null for a user that does not exist', async () => {
    findByIdLean.mockResolvedValue(null);
    const { lookupAudioStoragePrefix } = await import('~/server/functions/audio-storage');
    expect(await lookupAudioStoragePrefix(USER)).toBeNull();
  });
});
