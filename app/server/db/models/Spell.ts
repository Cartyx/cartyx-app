import mongoose from 'mongoose';
import { normalizeTags } from '~/server/utils/helpers';

const diceSchema = new mongoose.Schema({ count: Number, sides: Number }, { _id: false });

const modifierSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    type: { type: String, required: true },
    dice: { type: diceSchema, default: undefined },
    fixedValue: Number,
    damageType: String,
    atHigherLevels: String,
    notes: String,
  },
  { _id: false }
);

const conditionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    action: { type: String, required: true },
    condition: { type: String, required: true },
  },
  { _id: false }
);

const higherLevelSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    level: { type: Number, required: true },
    description: { type: String, required: true },
  },
  { _id: false }
);

const spellSchema = new mongoose.Schema({
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  source: { type: String, enum: ['srd', 'homebrew'], default: 'homebrew' },
  name: { type: String, required: true },
  description: { type: String, required: true },
  imageUrl: { type: String },
  level: { type: Number, required: true, min: 0, max: 9 },
  school: { type: String, required: true },
  version: { type: String },
  castingTime: {
    value: { type: Number, default: 1 },
    unit: { type: String, default: 'action' },
    reactionCondition: { type: String },
  },
  components: {
    verbal: { type: Boolean, default: false },
    somatic: { type: Boolean, default: false },
    material: { type: Boolean, default: false },
    materialDescription: { type: String },
  },
  range: {
    type: { type: String, default: 'self' },
    distance: { type: Number },
  },
  duration: {
    type: { type: String, default: 'instantaneous' },
    value: { type: Number },
    unit: { type: String },
    concentration: { type: Boolean, default: false },
  },
  ritual: { type: Boolean, default: false },
  higherLevelScaling: {
    enabled: { type: Boolean, default: false },
    type: { type: String },
  },
  classes: { type: [String], default: [] },
  attackSave: {
    kind: { type: String, default: 'none' },
    attackType: { type: String },
    saveAbility: { type: String },
    saveEffect: { type: String },
  },
  modifiers: { type: [modifierSchema], default: [] },
  conditions: { type: [conditionSchema], default: [] },
  higherLevels: { type: [higherLevelSchema], default: [] },
  areaOfEffect: {
    shape: { type: String, default: 'none' },
    size: { type: Number },
    width: { type: Number },
  },
  tags: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

spellSchema.pre('save', function () {
  if (this.isModified('tags')) {
    this.tags = normalizeTags(this.tags);
  }
  this.updatedAt = new Date();
});

spellSchema.pre('findOneAndUpdate', function () {
  const update = this.getUpdate() as unknown;
  if (!update) return;
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
if (typeof (spellSchema as { index?: unknown }).index === 'function') {
  spellSchema.index({ campaignId: 1 });
  spellSchema.index({ campaignId: 1, updatedAt: -1 });
  spellSchema.index({ campaignId: 1, level: 1 });
  spellSchema.index({ campaignId: 1, school: 1 });
  spellSchema.index({ createdBy: 1 });
  spellSchema.index({ tags: 1 });
  spellSchema.index({ name: 'text', description: 'text' });
}

export const Spell = mongoose.models.Spell || mongoose.model('Spell', spellSchema);
