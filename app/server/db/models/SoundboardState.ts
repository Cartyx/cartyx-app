import mongoose, { type InferSchemaType, type Model } from 'mongoose';
import { DEFAULT_VOLUME } from '~/types/soundboard';

// One item's live playback state on the board. `itemId` is a plain String
// (package-scoped, not a Mongo ref) — items live inside AudioPackage
// documents, not as separate collections, so there is nothing for an
// ObjectId ref to point at. `_id: false`: the client-supplied `itemId` is
// the only identity this subdocument needs.
const boardItemSchema = new mongoose.Schema(
  {
    itemId: { type: String, required: true },
    playing: { type: Boolean, default: false },
    volume: { type: Number, default: DEFAULT_VOLUME },
  },
  { _id: false }
);

// The GM board's live state, persisted per campaign so a mid-session reload
// does not silence the table. Its own collection (not embedded on
// Campaign): it takes debounced writes during play, and Campaign is read on
// nearly every request — embedding would put write amplification on a hot
// document.
const soundboardStateSchema = new mongoose.Schema({
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
  // Nullable: a campaign can have a live board with nothing loaded yet
  // (before the GM ever calls loadPackage).
  packageId: { type: mongoose.Schema.Types.ObjectId, ref: 'AudioPackage', default: null },
  // Package-scoped stable string id (Mood.id), not a Mongo ref — null when
  // no mood has been selected yet.
  moodId: { type: String, default: null },
  items: { type: [boardItemSchema], default: [] },
  masterVolume: { type: Number, default: DEFAULT_VOLUME },
  // Stamped on every write (Task 6's saveBoardState) with the Mongo User
  // _id, never an OAuth provider id — always set, since every document is
  // created and updated through the same save path.
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  updatedAt: { type: Date, default: Date.now },
});

soundboardStateSchema.pre('save', function () {
  this.updatedAt = new Date();
});

// istanbul ignore next
if (typeof (soundboardStateSchema as { index?: unknown }).index === 'function') {
  // One live state per campaign is the entire reason this collection is
  // separate from Campaign — Task 6's upsert
  // (findOneAndUpdate({ campaignId }, ..., { upsert: true })) depends on
  // there being exactly one document to write. `unique: true` is the point;
  // without it, concurrent upserts could race a second document into
  // existence and last-write-wins would no longer mean what it says.
  soundboardStateSchema.index({ campaignId: 1 }, { unique: true });
}

export type ISoundboardState = InferSchemaType<typeof soundboardStateSchema>;

export const SoundboardState: Model<ISoundboardState> =
  (mongoose.models.SoundboardState as Model<ISoundboardState>) ||
  mongoose.model<ISoundboardState>('SoundboardState', soundboardStateSchema);
