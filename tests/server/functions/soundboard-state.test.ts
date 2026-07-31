import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CampaignAccessError } from '~/server/utils/requireCampaignMember';

vi.mock('~/server/db/connection', () => ({ connectDB: vi.fn(), isDBConnected: vi.fn(() => true) }));
vi.mock('~/server/utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));

const requireCampaignMember = vi.fn();
/**
 * PARTIAL mock: the function is faked, but `CampaignAccessError` comes from
 * the real module. It has to — `reportSoundboardError` does an `instanceof`
 * against it, and a locally-redeclared stand-in class would make that check
 * pass here while proving nothing about the class the helper actually throws.
 */
vi.mock('~/server/utils/requireCampaignMember', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/server/utils/requireCampaignMember')>()),
  requireCampaignMember: (...args: unknown[]) => requireCampaignMember(...args),
}));

const findOneLean = vi.fn();
const findOne = vi.fn((_query?: Record<string, unknown>) => ({ lean: findOneLean }));
const findOneAndUpdate = vi.fn(
  (_filter?: unknown, _update?: unknown, _opts?: unknown): Promise<unknown> => Promise.resolve(null)
);

vi.mock('~/server/db/models/SoundboardState', () => ({
  SoundboardState: { findOne, findOneAndUpdate },
}));

const baseDoc = () => ({
  campaignId: 'c1',
  packageId: 'p1',
  moodId: 'm1',
  items: [{ itemId: 'i1', playing: true, volume: 0.5 }],
  masterVolume: 0.8,
  updatedBy: 'u1',
  updatedAt: new Date(0),
});

const member = (
  overrides: Partial<{ userId: string; sessionUserId: string; isGM: boolean }> = {}
) => ({
  userId: 'u1',
  sessionUserId: 'provider-1',
  isGM: true,
  ...overrides,
});

/**
 * `saveBoardStateSchema.items` uses `.default([])`, not `.optional()` — Zod's
 * OUTPUT type (what `z.infer` gives `saveBoardState`'s `data` parameter)
 * therefore requires `items` to be present, even though the schema's INPUT
 * type (what `.safeParse` accepts, pinned in
 * `tests/types/soundboard-schemas.test.ts`) allows omitting it. `saveBoardState`
 * receives already-Zod-parsed data (Task 7's `.inputValidator` output, same
 * convention as `packages.ts`'s `createPackage`/`clonePackage`, whose own
 * tests always supply `items`/`moods` explicitly for the same reason), so
 * every direct call in this file — bypassing `.parse()` — must too. This
 * fixture represents "nothing loaded": no `packageId`, no `moodId`, `items:
 * []`.
 */
const nothingLoaded = () => ({ campaignId: 'c1', items: [], masterVolume: 0.8 });

describe('loadBoardState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findOneLean.mockResolvedValue(null);
  });

  it('refuses a caller who is not in the campaign, before any model call', async () => {
    requireCampaignMember.mockRejectedValue(new CampaignAccessError());
    const { loadBoardState } = await import('~/server/functions/soundboard');
    await expect(loadBoardState({ data: { campaignId: 'c1' }, userId: 'u1' })).rejects.toThrow(
      'Campaign not found'
    );
    expect(findOne).not.toHaveBeenCalled();
  });

  /**
   * The GlitchTip amplification path, and the only one an attacker with NO
   * relationship to a campaign can reach: `loadBoardState` takes
   * `data.campaignId` straight from the request, so any authenticated user can
   * loop `loadBoardStateFn` over random 24-hex ids. Every rejection used to
   * file an exception against a shared single-node GlitchTip — one attacker,
   * unbounded event volume, no rate limit anywhere on the path.
   *
   * `packages.ts` already defends the identical hazard with
   * `PackageClientError`, and this file already classified the non-GM save
   * correctly; the not-a-member case was the one left loud.
   */
  it('does not report a not-a-member rejection to GlitchTip — attacker-controlled event volume otherwise', async () => {
    requireCampaignMember.mockRejectedValue(new CampaignAccessError());
    const { serverCaptureException } = await import('~/server/utils/telemetry');
    const { loadBoardState } = await import('~/server/functions/soundboard');
    await expect(loadBoardState({ data: { campaignId: 'c1' }, userId: 'u1' })).rejects.toThrow();
    expect(vi.mocked(serverCaptureException)).not.toHaveBeenCalled();
  });

  /**
   * The exclusion is scoped to the ONE error class the caller controls. A
   * session that resolves to no user, an unreachable Atlas, a genuine model
   * failure — all still report. Without this, "don't report auth failures"
   * quietly becomes "don't report anything `requireCampaignMember` throws".
   */
  it('still reports a genuine failure from the membership check', async () => {
    requireCampaignMember.mockRejectedValue(new Error('Database not available'));
    const { serverCaptureException } = await import('~/server/utils/telemetry');
    const { loadBoardState } = await import('~/server/functions/soundboard');
    await expect(loadBoardState({ data: { campaignId: 'c1' }, userId: 'u1' })).rejects.toThrow(
      'Database not available'
    );
    expect(vi.mocked(serverCaptureException)).toHaveBeenCalledTimes(1);
  });

  it('reads are scoped to the requested campaignId', async () => {
    requireCampaignMember.mockResolvedValue(member({ isGM: false }));
    findOneLean.mockResolvedValue(baseDoc());
    const { loadBoardState } = await import('~/server/functions/soundboard');
    await loadBoardState({ data: { campaignId: 'c1' }, userId: 'u1' });
    expect(vi.mocked(findOne).mock.calls[0][0]).toEqual({ campaignId: 'c1' });
  });

  it("is readable by a plain member, not just the GM — this is 2b's resync path", async () => {
    requireCampaignMember.mockResolvedValue(member({ isGM: false }));
    findOneLean.mockResolvedValue(baseDoc());
    const { loadBoardState } = await import('~/server/functions/soundboard');
    await expect(
      loadBoardState({ data: { campaignId: 'c1' }, userId: 'u1' })
    ).resolves.not.toBeNull();
  });

  it('returns null when no document exists yet, rather than throwing', async () => {
    requireCampaignMember.mockResolvedValue(member());
    findOneLean.mockResolvedValue(null);
    const { loadBoardState } = await import('~/server/functions/soundboard');
    const res = await loadBoardState({ data: { campaignId: 'c1' }, userId: 'u1' });
    expect(res).toBeNull();
  });

  it('serializes a document with nothing loaded (packageId/moodId null) without throwing', async () => {
    requireCampaignMember.mockResolvedValue(member());
    findOneLean.mockResolvedValue({ ...baseDoc(), packageId: null, moodId: null, items: [] });
    const { loadBoardState } = await import('~/server/functions/soundboard');
    const res = await loadBoardState({ data: { campaignId: 'c1' }, userId: 'u1' });
    expect(res?.packageId).toBeNull();
    expect(res?.moodId).toBeNull();
  });

  it('serializes a fully-loaded document', async () => {
    requireCampaignMember.mockResolvedValue(member());
    findOneLean.mockResolvedValue(baseDoc());
    const { loadBoardState } = await import('~/server/functions/soundboard');
    const res = await loadBoardState({ data: { campaignId: 'c1' }, userId: 'u1' });
    expect(res).toEqual({
      campaignId: 'c1',
      packageId: 'p1',
      moodId: 'm1',
      items: [{ itemId: 'i1', playing: true, volume: 0.5 }],
      masterVolume: 0.8,
    });
  });
});

describe('saveBoardState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findOneAndUpdate.mockResolvedValue(baseDoc());
  });

  it('refuses a caller who is not in the campaign, before any model call', async () => {
    requireCampaignMember.mockRejectedValue(new CampaignAccessError());
    const { saveBoardState } = await import('~/server/functions/soundboard');
    await expect(saveBoardState({ data: nothingLoaded(), userId: 'u1' })).rejects.toThrow();
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  /**
   * The GM gate has teeth ONLY if this test fails for the guard being
   * deleted — not because `requireCampaignMember` itself rejected. So the
   * helper must resolve successfully with `isGM: false` here; a rejecting
   * helper would prove the membership gate, not this one.
   */
  it('refuses a save from a non-GM member, and never touches the model', async () => {
    requireCampaignMember.mockResolvedValue(member({ isGM: false }));
    const { saveBoardState } = await import('~/server/functions/soundboard');
    await expect(saveBoardState({ data: nothingLoaded(), userId: 'u1' })).rejects.toThrow(
      /forbidden/i
    );
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('upserts on campaignId so a campaign never accumulates two states', async () => {
    requireCampaignMember.mockResolvedValue(member());
    const { saveBoardState } = await import('~/server/functions/soundboard');
    await saveBoardState({ data: nothingLoaded(), userId: 'u1' });
    const [filter, , opts] = vi.mocked(findOneAndUpdate).mock.calls[0];
    expect(filter).toEqual({ campaignId: 'c1' });
    expect(opts).toMatchObject({ upsert: true });
  });

  it('accepts a save of a board with nothing loaded (no packageId, no moodId, no items)', async () => {
    requireCampaignMember.mockResolvedValue(member());
    const { saveBoardState } = await import('~/server/functions/soundboard');
    await saveBoardState({ data: nothingLoaded(), userId: 'u1' });
    const [, update] = vi.mocked(findOneAndUpdate).mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    expect(update.$set.packageId).toBeNull();
    expect(update.$set.moodId).toBeNull();
  });

  /**
   * `updatedBy` must be the Mongo `_id` that `requireCampaignMember` itself
   * verified, NEVER the caller-supplied `userId` argument — that argument is
   * untrusted (Task 7's wrapper passes it through for telemetry only; see
   * `packages.ts`'s identical `Actor`/`telemetryId` split). Passing a
   * mismatched `userId` here and asserting the model still receives the
   * verified id proves the write can't be spoofed by whatever the caller
   * hands the function.
   */
  it('stamps updatedBy with the id requireCampaignMember verified, not the passed userId', async () => {
    requireCampaignMember.mockResolvedValue(member({ userId: 'verified-mongo-id' }));
    const { saveBoardState } = await import('~/server/functions/soundboard');
    await saveBoardState({
      data: nothingLoaded(),
      userId: 'untrusted-caller-supplied-id',
    });
    const [, update] = vi.mocked(findOneAndUpdate).mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    expect(update.$set.updatedBy).toBe('verified-mongo-id');
  });

  /**
   * `pre('save')` (Task 3's model) does not fire on `findOneAndUpdate` —
   * `updatedAt` must be set explicitly in the `$set`, matching every
   * `findOneAndUpdate` call site in `audio.ts`.
   */
  it('sets updatedAt explicitly in the update payload', async () => {
    requireCampaignMember.mockResolvedValue(member());
    const { saveBoardState } = await import('~/server/functions/soundboard');
    await saveBoardState({ data: nothingLoaded(), userId: 'u1' });
    const [, update] = vi.mocked(findOneAndUpdate).mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    expect(update.$set.updatedAt).toBeInstanceOf(Date);
  });

  it('passes through items and masterVolume from the payload', async () => {
    requireCampaignMember.mockResolvedValue(member());
    const { saveBoardState } = await import('~/server/functions/soundboard');
    await saveBoardState({
      data: {
        campaignId: 'c1',
        packageId: 'p1',
        moodId: 'm1',
        items: [{ itemId: 'i1', playing: true, volume: 0.5 }],
        masterVolume: 0.8,
      },
      userId: 'u1',
    });
    const [, update] = vi.mocked(findOneAndUpdate).mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    expect(update.$set.items).toEqual([{ itemId: 'i1', playing: true, volume: 0.5 }]);
    expect(update.$set.masterVolume).toBe(0.8);
  });

  it('returns the serialized saved state', async () => {
    requireCampaignMember.mockResolvedValue(member());
    findOneAndUpdate.mockResolvedValue(baseDoc());
    const { saveBoardState } = await import('~/server/functions/soundboard');
    const res = await saveBoardState({
      data: nothingLoaded(),
      userId: 'u1',
    });
    expect(res).toEqual({
      campaignId: 'c1',
      packageId: 'p1',
      moodId: 'm1',
      items: [{ itemId: 'i1', playing: true, volume: 0.5 }],
      masterVolume: 0.8,
    });
  });

  it('emits board_state_saved with distinctId first, tagged with the session identity', async () => {
    requireCampaignMember.mockResolvedValue(member());
    const { serverCaptureEvent } = await import('~/server/utils/telemetry');
    const { saveBoardState } = await import('~/server/functions/soundboard');
    await saveBoardState({
      data: nothingLoaded(),
      userId: 'mongo-id-1',
      sessionUserId: 'provider-id-1',
    });
    expect(vi.mocked(serverCaptureEvent).mock.calls[0]).toEqual([
      'provider-id-1',
      'board_state_saved',
      { campaignId: 'c1' },
    ]);
  });

  it("does not report a non-GM Forbidden to GlitchTip — it is the caller's own doing, not a server fault", async () => {
    requireCampaignMember.mockResolvedValue(member({ isGM: false }));
    const { serverCaptureException } = await import('~/server/utils/telemetry');
    const { saveBoardState } = await import('~/server/functions/soundboard');
    await expect(saveBoardState({ data: nothingLoaded(), userId: 'u1' })).rejects.toThrow();
    expect(vi.mocked(serverCaptureException)).not.toHaveBeenCalled();
  });
});
