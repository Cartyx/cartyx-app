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

  sourceKey: {
    type: String,
    required: function (this: { status?: string }) {
      return this.status !== 'failed';
    },
  },
  // The object's REAL size, measured by confirmAudioUpload's HeadObject. Null
  // until then — deliberately: this used to be seeded at row creation from the
  // client's self-declared `bytes`, which meant anything reading it before
  // confirm got an unverified number the uploader chose.
  sourceBytes: { type: Number, default: null },
  // Written ONLY by a confirm SUCCESS path — `confirmAudioUpload`'s, and
  // `confirmOnceVariantUpload`'s. (This comment used to claim a single writer;
  // that was never true once Task 18 landed, and a false premise reads exactly
  // like a true one to whoever builds the next guard on it. After a
  // once-attach this field describes the ONCE-source's HeadObject, not the
  // main source's.)
  //
  // What is true of BOTH writers is the property everything downstream
  // actually depends on: it is set only after an object passed the HeadObject
  // size/type check, which is the only real enforcement of AUDIO_MAX_BYTES in
  // the system (a presigned PUT cannot constrain Content-Length). So a null
  // value still means "nothing on this row has ever been measured", and a
  // non-null one still means something was. `retryAudioAsset` gates on it so
  // an abandoned upload the worker's reaper aged into `failed` can never be
  // pushed into the transcode queue — and a once-attach cannot forge that,
  // because it requires `status: 'ready'`, which requires the main confirm to
  // have already run and stamped this once.
  //
  // Cross-service contract field: declared here because the web app owns
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
  //
  // INVARIANT, load-bearing: this field must be reset to `null` at EVERY
  // site that clears or replaces `onceSourceKey` above, not only where it
  // is set. It describes the object the key points at, so once the key
  // stops pointing at that object, a standing byte count is a lie the
  // storage quota can't detect — it just silently over-counts, forever,
  // until (if ever) a future successful attach happens to overwrite it.
  // Task 3b's review caught exactly this: the field was added and wired
  // into the quota and the one write that SETS it, but not into the
  // sites that clear/replace the key. Every current site that writes
  // `onceSourceKey` also writes this field in the same `$set`:
  // `createOnceVariantUpload` (replace, -> null) and
  // `confirmOnceVariantUpload`'s reject path (clear, -> null) in
  // `app/server/functions/audio.ts`; `markOnceFailed` in
  // `audio-worker/src/process.ts` and `reapAbandonedOnceUploads` in
  // `audio-worker/src/claim.ts` (both clear, -> null). If `onceSourceKey`
  // ever grows a new writer, that writer owns this field too.
  onceSourceBytes: { type: Number, default: null },
  // When the CURRENT once-variant attach presigned its upload — the clock
  // `reapAbandonedOnceUploads` (audio-worker/src/claim.ts) measures a stuck
  // attach against. Cross-service contract field: written here, read only by
  // the worker.
  //
  // It exists because that reaper used to gate on `updatedAt`, and
  // `updatedAt` cannot answer the question it was being asked. "How long has
  // this attach been stuck?" is a JOB-LIVENESS question; `updatedAt` answers
  // "when was this document last modified at all", and unrelated writers
  // legitimately bump it. `updateAudioAsset` and `bulkTagAudioAssets` are
  // both unfenced facet edits — retitle the track, add a tag — so a GM who
  // edits an asset whose once-attach died mid-PUT pushes the reap out by the
  // full timeout, every time, and there is no self-service recovery:
  // `createOnceVariantUpload` requires `status: 'ready'` and the row is
  // stuck in `uploading`. Editing it again (or a bulk retag that happens to
  // include it) postpones it again, indefinitely. A dedicated field is
  // immune by construction. (The mirror-image case is `AudioPackage`'s
  // optimistic-concurrency precondition, which is CORRECTLY `updatedAt`:
  // there the question really is "has this document been modified since I
  // read it", so any writer bumping it should be a conflict.)
  //
  // INVARIANT, and it is what keeps this field cheap: it has EXACTLY ONE
  // writer, `createOnceVariantUpload` in `app/server/functions/audio.ts`,
  // which is also the only write in either package that can put a row into
  // `status: 'uploading', variant: 'once'` — the only state the reaper reads
  // it in. Nothing else may stamp it, and nothing needs to clear it: a value
  // left over from a finished attach is unreachable, because getting back
  // into the state that reads it necessarily runs the one writer again. If a
  // second path into `uploading`/`once` is ever added, that path owns this
  // field too.
  //
  // Rows written before this field existed lack it, and the reaper falls
  // back to `updatedAt` for exactly those (see its `$or`) — old rows keep
  // today's behaviour rather than being treated as infinitely stale, which
  // would reap every in-flight attach at deploy time.
  onceUploadStartedAt: { type: Date, default: null },
  // Which pipeline pass the row's CURRENT status/attempts/claim state
  // describes: 'main' for the ordinary source -> renditions pipeline (every
  // asset, including every one that predates this field), 'once' while a
  // Task 18 once-variant attach is queued/processing. The worker
  // (`processAsset`) reads this to pick its source object
  // (`sourceKey`/`onceSourceKey`) and its destination field
  // (`renditions`/`onceRenditions`) — "same pipeline, different
  // destination field," per the design doc's own framing.
  //
  // On EVERY terminal outcome of a once-variant run the worker resets this to
  // 'main' and flips `status` back to 'ready' — never `'failed'`. That is
  // three paths, not the two Task 18 closed: `markOnceFailed` covers the
  // permanent-error and budget-exhausted branches inside `processAsset`, and
  // `reapStale`'s own attempts-exhausted `updateMany` (audio-worker/src/
  // claim.ts) covers the case where the worker DIED rather than threw, so
  // `processAsset`'s catch never ran at all. That third path used to fall
  // through to the main pipeline's `failed`/`lastError` write and brick the
  // music asset exactly as described below.
  // This is a Task 18 review fix, not the original design: `status`:
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
