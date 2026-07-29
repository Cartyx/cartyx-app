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
  // Reserved for phase 2's ∞/1× music variants. Never written in phase 1.
  onceRenditions: {
    opus: { type: renditionSchema, default: undefined },
    aac: { type: renditionSchema, default: undefined },
  },

  durationMs: { type: Number, default: null },
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
  audioAssetSchema.index({ ownerId: 1, kind: 1 });
  audioAssetSchema.index({ ownerId: 1, tags: 1 });
  audioAssetSchema.index({ ownerId: 1, createdAt: -1 });
  // Drives the worker's atomic claim.
  audioAssetSchema.index({ status: 1, createdAt: 1 });
  audioAssetSchema.index({ title: 'text' });
}

export type IAudioAsset = InferSchemaType<typeof audioAssetSchema>;

export const AudioAsset: Model<IAudioAsset> =
  (mongoose.models.AudioAsset as Model<IAudioAsset>) ||
  mongoose.model<IAudioAsset>('AudioAsset', audioAssetSchema);
