import mongoose, { type InferSchemaType, type Model } from 'mongoose';
import { DEFAULT_FADE_SECONDS, DEFAULT_VOLUME } from '~/types/soundboard';

// A single pad. `id` is stable WITHIN THE PACKAGE — `Mood.states[].itemId`
// references it, never `assetId` — which is what lets one asset appear in
// many moods at different volumes/rates without duplicating the item.
// `_id: false`: the client-supplied `id` is the only identity this
// subdocument needs, and Task 5's clone preserves it across the copy — a
// Mongo-generated `_id` here would be noise a clone would have to strip.
const packageItemSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    assetId: { type: mongoose.Schema.Types.ObjectId, ref: 'AudioAsset', required: true },
    label: { type: String, default: null },
    volume: { type: Number, default: DEFAULT_VOLUME },
    fadeSeconds: { type: Number, default: DEFAULT_FADE_SECONDS },
    loop: { type: Boolean, default: false },
    randomIntervalMin: { type: Number, default: null },
    randomIntervalMax: { type: Number, default: null },
    volumeJitter: { type: Number, default: null },
    panJitter: { type: Number, default: null },
    sortIndex: { type: Number, default: 0 },
  },
  { _id: false }
);

// One item's playback state as overridden by a mood. Every override field is
// nullable/optional with NO default value that would collide with a
// meaningful override (`0`, `false`) — Task 8's `resolveItemState` depends on
// `mood ?? item` being able to tell "not set, inherit" apart from "set to
// zero/off". `itemId` is a plain String (package-scoped, not a Mongo ref) —
// see the design doc: moods reference `item.id`, never `assetId`.
const moodStateSchema = new mongoose.Schema(
  {
    itemId: { type: String, required: true },
    playing: { type: Boolean, default: false },
    volume: { type: Number, default: null },
    fadeSeconds: { type: Number, default: null },
    randomIntervalMin: { type: Number, default: null },
    randomIntervalMax: { type: Number, default: null },
  },
  { _id: false }
);

// A named preset within a package. `_id: false` for the same clone-safety
// reason as `packageItemSchema` above — `id` is the client-supplied, stable
// identity.
const moodSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    states: { type: [moodStateSchema], default: [] },
  },
  { _id: false }
);

const audioPackageSchema = new mongoose.Schema({
  // Nullable, and deliberately NOT required: null is the entire mechanism
  // that makes a package a system package (phase 3's generated catalogue),
  // readable by everyone and editable by no one. Task 4's visibility rule
  // ($or: [{ ownerId: userId }, { ownerId: null }]) is built directly on
  // this field being able to hold null.
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  name: { type: String, required: true },
  description: { type: String, default: null },
  items: { type: [packageItemSchema], default: [] },
  moods: { type: [moodSchema], default: [] },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

audioPackageSchema.pre('save', function () {
  this.updatedAt = new Date();
});

// istanbul ignore next
if (typeof (audioPackageSchema as { index?: unknown }).index === 'function') {
  // Task 4's visibility query: `$or: [{ ownerId: userId }, { ownerId: null }]`,
  // and the "my packages" list.
  audioPackageSchema.index({ ownerId: 1 });
  // A name-filtered/sorted listing within an owner's (or the system's, via
  // ownerId: null) packages.
  audioPackageSchema.index({ ownerId: 1, name: 1 });
}

export type IAudioPackage = InferSchemaType<typeof audioPackageSchema>;

export const AudioPackage: Model<IAudioPackage> =
  (mongoose.models.AudioPackage as Model<IAudioPackage>) ||
  mongoose.model<IAudioPackage>('AudioPackage', audioPackageSchema);
