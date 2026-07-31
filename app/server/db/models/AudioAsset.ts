import mongoose, { type InferSchemaType, type Model } from 'mongoose';
import { normalizeTags } from '~/server/utils/helpers';
import { AUDIO_KINDS, AUDIO_STATUSES } from '~/types/audio';

const renditionSchema = new mongoose.Schema(
  { key: String, url: String, bytes: Number },
  { _id: false }
);

const audioAssetSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  kind: { type: String, enum: AUDIO_KINDS, required: true },

  environment: { type: [String], default: [] },
  mood: { type: [String], default: [] },
  intensity: { type: Number, min: 1, max: 5, default: null },
  tags: { type: [String], default: [] },

  sourceKey: { type: String, required: true },
  // The object's REAL size, measured by confirmAudioUpload's HeadObject. Null
  // until then — deliberately: this used to be seeded at row creation from the
  // client's self-declared `bytes`, which meant anything reading it before
  // confirm got an unverified number the uploader chose.
  sourceBytes: { type: Number, default: null },
  // Set by confirmAudioUpload's success path and by nothing else, ever. That
  // exclusivity is the point: it is the one field that proves an object passed
  // the HeadObject size/type check, which is the only real enforcement of
  // AUDIO_MAX_BYTES in the system (a presigned PUT cannot constrain
  // Content-Length). `retryAudioAsset` gates on it so an abandoned upload the
  // worker's reaper aged into `failed` can never be pushed into the transcode
  // queue. Cross-service contract field: declared here because the web app owns
  // the schema, even though the worker doesn't read it.
  confirmedAt: { type: Date, default: null },
  renditions: {
    opus: { type: renditionSchema, default: undefined },
    aac: { type: renditionSchema, default: undefined },
  },
  // The phase 2 ∞/1× music variant (`kind: 'music'` only) — the composed
  // ending the board's `1×` position plays instead of looping. Written by
  // Task 18's attach flow (`createOnceVariantUpload` -> confirm -> the
  // worker), never at main ingest time. Every reader must still treat this
  // as optional: an asset attached before Task 18, or one whose owner never
  // attaches a once-variant, has it absent forever.
  onceRenditions: {
    opus: { type: renditionSchema, default: undefined },
    aac: { type: renditionSchema, default: undefined },
  },
  // The once-variant's own uploaded source object key, mirroring `sourceKey`
  // above. Null until `createOnceVariantUpload` presigns one. Kept
  // separately from `sourceKey` rather than overwriting it: the main
  // source must survive so the asset can still be re-transcoded from it,
  // and the two need independent keys so their renditions can't collide
  // (see `variant` below and `renditionKeyBase`'s callers in
  // audio-worker/src/process.ts).
  onceSourceKey: { type: String, default: null },
  // The once-source object's REAL size, measured by
  // `confirmOnceVariantUpload`'s HeadObject — mirrors `sourceBytes` above,
  // same shape and same nullability, for the same reason: null until
  // confirm, never seeded from anything client-declared. Set by
  // `confirmOnceVariantUpload`'s success path and by nothing else. Rows
  // written before this field existed simply lack it; `getUserStorageUsage`
  // treats absent the same as null (see `audio-quota.ts`'s `$ifNull`
  // guard). The worker's terminal write for a successful once-attach
  // (`audio-worker/src/process.ts`) does not clear this alongside
  // `onceSourceKey` — the once-source object stays live and billed after a
  // successful attach, which is why this field exists: without it those
  // bytes were measured once for the `AUDIO_MAX_BYTES` gate and then never
  // recorded anywhere the storage quota could see.
  onceSourceBytes: { type: Number, default: null },
  // Which pipeline pass the row's CURRENT status/attempts/claim state
  // describes: 'main' for the ordinary source -> renditions pipeline (every
  // asset, including every one that predates this field), 'once' while a
  // Task 18 once-variant attach is queued/processing. The worker
  // (`processAsset`) reads this to pick its source object
  // (`sourceKey`/`onceSourceKey`) and its destination field
  // (`renditions`/`onceRenditions`) — "same pipeline, different
  // destination field," per the design doc's own framing.
  //
  // On BOTH a successful AND a failed once-variant run the worker resets
  // this to 'main' and flips `status` back to 'ready' — never `'failed'`.
  // This is a Task 18 review fix, not the original design: `status:
  // 'failed'` describes the WHOLE row under this shared-state scheme, so a
  // failed once-variant used to be indistinguishable from a failed MAIN
  // asset, and a `PermanentError` (over-cap, silent, ...) on the once file
  // would set `permanentFailure: true` on what could be a perfectly good,
  // already-`ready` music asset — `retryAudioAsset` refuses those rows, so
  // there was no path back to `ready` short of delete-and-re-upload. See
  // `markOnceFailed` in audio-worker/src/process.ts and `onceLastError`
  // below. A once job is therefore never retried in place; the user just
  // attaches again, which is why `createOnceVariantUpload` resets
  // `attempts: 0` on every new attach rather than this field carrying retry
  // state across attempts.
  //
  // Reusing one status/attempts/claim state for a second job type is the
  // trade-off this collection's own design doc names explicitly — and
  // names as a STOP CONDITION, not a sanction: "if a second job type is
  // ever added this SHOULD BECOME a real queue rather than growing more
  // status enums." Task 18 is that second job type. The queue was reused
  // anyway, deliberately, to avoid building the real per-variant queue as
  // part of this task; the once-specific reap path
  // (`reapAbandonedOnceUploads` in audio-worker/src/claim.ts) and
  // `markOnceFailed` exist specifically to contain the two ways that reuse
  // was found to cause data loss (see Task 18's report, "Fix round 1"). The
  // remaining, accepted consequence: while a once-variant attach is
  // uploading/pending/processing, `status` no longer reads 'ready' for the
  // WHOLE row, so the main rendition — already finished, and never touched
  // by this job — is briefly reported as
  // uploading/pending/processing everywhere `status` is read (the board's
  // play gate, listAudioAssets, the library row). A genuine per-variant
  // queue (`onceStatus`/`onceAttempts`/...) is the real fix for that,
  // still out of scope here.
  //
  // "BRIEFLY" IS NOT THE WHOLE COST, and the exception is worth knowing
  // before anyone reads this consequence as cosmetic. On the GM's live
  // board the window is transient in Atlas but TERMINAL for that pad:
  // `useSoundboard`'s `loadAsset` THROWS for a pending/uploading/processing
  // asset, and `app/lib/soundboard/engine.ts`'s `ensureAsset` catches that
  // by adding the asset to its `unplayable` set — which nothing ever
  // clears for the engine's lifetime. So a GM who attaches a once-variant
  // to a track already loaded on a board loses that pad for the rest of the
  // session, even though the attach finishes seconds later and the main
  // renditions were never touched; only a reload (or a re-enable, which
  // builds a fresh engine) brings it back. It is not literally silent — the
  // pad renders "Failed to decode this rendition" via `onLoadError` — but
  // that reason is wrong, and it never goes away on its own. The same
  // per-variant queue fixes this; so, more cheaply, would clearing
  // `unplayable` when an asset is seen `ready` again.
  variant: { type: String, enum: ['main', 'once'], default: 'main' },
  // The once job's own error, kept separate from `lastError` (which
  // describes the MAIN pipeline and must never be overwritten by a once
  // failure). Set by `markOnceFailed`/`reapAbandonedOnceUploads` whenever a
  // once-variant run fails or is abandoned; cleared implicitly by nothing —
  // it is display-only context for "what happened last time," overwritten
  // by the next attach attempt's own failure, if any, and left stale
  // (harmlessly) after a successful attach.
  onceLastError: { type: String, default: null },

  durationMs: { type: Number, default: null },
  // Exact decoded length in samples per channel at 48 kHz (the rate every
  // rendition is produced at — see RENDITION_SAMPLE_RATE in
  // audio-worker/src/ffmpeg.ts), NOT at `sampleRate` below, which records what
  // the source happened to be.
  //
  // Cross-service contract field: written by the worker through the raw driver
  // (`processAsset`), declared here because the web app owns the schema.
  //
  // This is the field phase 2's gapless looping must read. `durationMs` is
  // rounded to whole milliseconds, so `loopEnd = durationMs / 1000` is off by
  // up to ±24 samples for every asset before any format-specific error, and
  // the container's own duration adds more on top (+312 samples for an
  // Ogg/Opus upload, +1440 for ADTS AAC — both measured). An audible tick on
  // every repeat of an ambience loop is the failure that produces.
  durationSamples: { type: Number, default: null },
  // The loudnorm TARGET the worker normalized to (-20), not a measurement:
  // single-pass loudnorm doesn't guarantee the output lands on it. Named for
  // what it is so phase 2's gain logic can't mistake it for a measured value;
  // a real two-pass measurement would be a separate `loudnessLufs` field.
  loudnessTargetLufs: { type: Number, default: null },
  sampleRate: { type: Number, default: null },
  channels: { type: Number, default: null },
  peaks: { type: [Number], default: [] },

  status: { type: String, enum: AUDIO_STATUSES, default: 'uploading' },
  attempts: { type: Number, default: 0 },
  lastError: { type: String, default: null },
  // "This source can never succeed" — set by the worker when a validation step
  // rejects the file itself (over the 30-minute cap, zero samples, wholly
  // silent, truncated) rather than when a transient fault ran out of attempts.
  // `retryAudioAsset` refuses rows carrying it: the file is poison on every
  // run, and each Retry click would buy another pass of pinned CPU on a
  // single-node cluster for a guaranteed identical outcome. Cross-service
  // contract field, written by the worker through the raw driver.
  permanentFailure: { type: Boolean, default: false },
  claimedAt: { type: Date, default: null },
  claimedBy: { type: String, default: null },
  // Retry backoff gate, written by the audio worker (`requeueForRetry` in
  // audio-worker/src/process.ts) and read by its claim query
  // (`claimNext` in audio-worker/src/claim.ts): a `pending` row is only
  // claimable once this is null/absent or in the past. Declared here because
  // the field is a cross-service contract, not worker-local state — the web
  // app owns the schema both services write.
  nextAttemptAt: { type: Date, default: null },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

audioAssetSchema.pre('save', function () {
  if (this.isModified('tags')) {
    this.tags = normalizeTags(this.tags);
  }
  this.updatedAt = new Date();
});

// istanbul ignore next
if (typeof (audioAssetSchema as { index?: unknown }).index === 'function') {
  // `listAudioAssets`'s `kind` filter, and its `{ tags: { $all: [...] } }`
  // filter (multikey).
  audioAssetSchema.index({ ownerId: 1, kind: 1 });
  audioAssetSchema.index({ ownerId: 1, tags: 1 });
  // The unfiltered library page: `find({ ownerId }).sort({ createdAt: -1, _id: -1 })`,
  // plus the compound pagination cursor's `createdAt` range.
  audioAssetSchema.index({ ownerId: 1, createdAt: -1 });
  // Drives the worker's atomic claim: `claimNext` matches `{ status: 'pending', ... }`
  // and sorts `{ createdAt: 1 }` (audio-worker/src/claim.ts), and `reapStale`
  // matches on `status` too.
  audioAssetSchema.index({ status: 1, createdAt: 1 });
  // There is deliberately NO `{ title: 'text' }` index. Title search is
  // `{ $regex: escapeRegExp(search), $options: 'i' }` in `listAudioAssets` —
  // `$text` is not used anywhere in this codebase, and a text index cannot
  // serve a `$regex` query. It only ever cost: Atlas tokenizes and writes an
  // index entry per word of every title on every insert and every title edit,
  // to answer a query nothing issues.
}

export type IAudioAsset = InferSchemaType<typeof audioAssetSchema>;

export const AudioAsset: Model<IAudioAsset> =
  (mongoose.models.AudioAsset as Model<IAudioAsset>) ||
  mongoose.model<IAudioAsset>('AudioAsset', audioAssetSchema);
