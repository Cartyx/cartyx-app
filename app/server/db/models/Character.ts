import mongoose, { type InferSchemaType, type Model } from 'mongoose';
import { normalizeTags } from '~/server/utils/helpers';

const pictureCropSchema = new mongoose.Schema(
  {
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
  },
  { _id: false }
);

const relationshipSchema = new mongoose.Schema(
  {
    characterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Character', required: true },
    descriptor: { type: String, required: true },
    isPublic: { type: Boolean, default: false },
  },
  { _id: false }
);

const statusSchema = new mongoose.Schema(
  {
    value: { type: String, enum: ['alive', 'deceased'], default: 'alive' },
    changedAt: { type: Date, default: null },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false }
);

const characterSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  race: { type: String, default: '' },
  characterClass: { type: String, default: '' },
  age: { type: Number, default: null },
  location: { type: String, default: '' },
  link: { type: String, default: '' },
  picture: { type: String, default: '' },
  pictureCrop: { type: pictureCropSchema, default: null },
  notes: { type: String, default: '' },
  gmNotes: { type: String, default: '' },
  tags: { type: [String], default: [] },
  isPublic: { type: Boolean, default: false },
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: false },
  sessions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Session' }],
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  status: { type: statusSchema, default: () => ({ value: 'alive' }) },
  relationships: { type: [relationshipSchema], default: [] },
});

characterSchema.pre('save', function () {
  if (this.isModified('tags')) {
    this.tags = normalizeTags(this.tags);
  }
  this.updatedAt = new Date();
});

characterSchema.pre('findOneAndUpdate', function () {
  const update = this.getUpdate() as unknown;
  if (!update) return;

  if (Array.isArray(update)) {
    // Aggregation pipeline: only patch existing $set stages, never mutate others
    let hasSetStage = false;
    update.forEach((stage) => {
      if (!stage || typeof stage !== 'object') return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mongoose pipeline stage
      const stageObj = stage as Record<string, any>;
      if (!('$set' in stageObj)) return;
      hasSetStage = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mongoose $set object
      const set = stageObj.$set as Record<string, any>;
      if (Array.isArray(set.tags)) {
        set.tags = normalizeTags(set.tags as string[]);
      }
      set.updatedAt = new Date();
    });
    if (!hasSetStage) {
      update.push({ $set: { updatedAt: new Date() } });
    }
    this.setUpdate(update);
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mongoose update object
  const updateObj = update as Record<string, any>;
  if ('$set' in updateObj) {
    const set = (updateObj.$set ??= {});
    if (Array.isArray(set.tags)) {
      set.tags = normalizeTags(set.tags as string[]);
    }
    set.updatedAt = new Date();
  } else {
    if (Array.isArray(updateObj.tags)) {
      updateObj.tags = normalizeTags(updateObj.tags as string[]);
    }
    updateObj.updatedAt = new Date();
  }
});

// istanbul ignore next
if (typeof (characterSchema as { index?: unknown }).index === 'function') {
  characterSchema.index({ campaignId: 1 });
  characterSchema.index({ campaignId: 1, updatedAt: -1 });
  characterSchema.index({ sessionId: 1 });
  characterSchema.index({ sessions: 1 });
  characterSchema.index({ createdBy: 1 });
  characterSchema.index({ tags: 1 });
  characterSchema.index({ isPublic: 1 });
  characterSchema.index({
    firstName: 'text',
    lastName: 'text',
    race: 'text',
    location: 'text',
    notes: 'text',
  });
}

export type ICharacter = InferSchemaType<typeof characterSchema>;

export const Character: Model<ICharacter> =
  (mongoose.models.Character as Model<ICharacter>) ||
  mongoose.model<ICharacter>('Character', characterSchema);
