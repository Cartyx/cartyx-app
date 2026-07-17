import mongoose, { type InferSchemaType, type Model } from 'mongoose';

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

const playerSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  race: { type: String, required: true },
  characterClass: { type: String, required: true },
  age: { type: Number, required: true },
  gender: { type: String, default: '' },
  location: { type: String, default: '' },
  link: { type: String, default: '' },
  picture: { type: String, default: '' },
  pictureCrop: { type: pictureCropSchema, default: null },
  description: { type: String, default: '' },
  backstory: { type: String, default: '' },
  gmNotes: { type: String, default: '' },
  color: { type: String, default: '#3498db' },
  eyeColor: { type: String, default: '' },
  hairColor: { type: String, default: '' },
  weight: { type: Number, default: null },
  height: { type: String, default: '' },
  size: { type: String, default: '' },
  appearance: { type: String, default: '' },
  status: { type: statusSchema, default: () => ({ value: 'alive' }) },
  relationships: { type: [relationshipSchema], default: [] },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

playerSchema.pre('save', function () {
  this.updatedAt = new Date();
});

playerSchema.pre('findOneAndUpdate', function () {
  const update = this.getUpdate() as unknown;
  if (!update) return;

  if (Array.isArray(update)) {
    let hasSetStage = false;
    update.forEach((stage) => {
      if (!stage || typeof stage !== 'object') return;
      const stageObj = stage as Record<string, unknown>;
      if (!('$set' in stageObj)) return;
      hasSetStage = true;
      (stageObj.$set as Record<string, unknown>).updatedAt = new Date();
    });
    if (!hasSetStage) {
      update.push({ $set: { updatedAt: new Date() } });
    }
    this.setUpdate(update);
    return;
  }

  const updateObj = update as Record<string, unknown>;
  if ('$set' in updateObj) {
    ((updateObj.$set as Record<string, unknown>) ??= {}).updatedAt = new Date();
  } else {
    updateObj.updatedAt = new Date();
  }
});

// istanbul ignore next
if (typeof (playerSchema as { index?: unknown }).index === 'function') {
  playerSchema.index({ campaignId: 1 });
  playerSchema.index({ campaignId: 1, updatedAt: -1 });
  playerSchema.index({ createdBy: 1 });
  playerSchema.index({ 'status.value': 1 });
  playerSchema.index({
    firstName: 'text',
    lastName: 'text',
    race: 'text',
    location: 'text',
  });
}

export type IPlayer = InferSchemaType<typeof playerSchema>;

export const Player: Model<IPlayer> =
  (mongoose.models.Player as Model<IPlayer>) || mongoose.model<IPlayer>('Player', playerSchema);
