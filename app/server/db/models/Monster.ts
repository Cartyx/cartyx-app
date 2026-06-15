import mongoose from 'mongoose';

// Picture crop reused from Character/Player — same shape.
const pictureCropSchema = new mongoose.Schema(
  {
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
  },
  { _id: false }
);

const abilityScoreSchema = new mongoose.Schema(
  {
    score: { type: Number, default: 10 },
    mod: { type: Number, default: 0 },
    save: { type: Number, default: 0 },
  },
  { _id: false }
);

const speedSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ['walk', 'fly', 'swim', 'climb', 'burrow'],
      required: true,
    },
    feet: { type: Number, default: 30 },
    notes: { type: String, default: '' },
  },
  { _id: false }
);

const skillSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    modifier: { type: Number, default: 0 },
  },
  { _id: false }
);

const senseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    range: { type: Number, default: null },
  },
  { _id: false }
);

const featureSchema = new mongoose.Schema(
  {
    section: {
      type: String,
      enum: ['traits', 'actions', 'bonusActions', 'reactions', 'legendaryActions'],
      required: true,
    },
    name: { type: String, required: true },
    description: { type: String, default: '' },
  },
  { _id: false }
);

const linkSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    url: { type: String, required: true },
  },
  { _id: false }
);

const crSchema = new mongoose.Schema(
  {
    value: { type: Number, default: 0 }, // 0, 0.125 (1/8), 0.25 (1/4), 0.5 (1/2), int
    xp: { type: Number, default: 0 },
    proficiencyBonus: { type: Number, default: 2 },
  },
  { _id: false }
);

const monsterSchema = new mongoose.Schema({
  // ---- Identity / taxonomy ----
  name: { type: String, required: true },
  size: {
    type: String,
    enum: ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'],
    default: 'medium',
  },
  type: { type: String, default: '' },
  subtype: { type: String, default: '' },
  alignment: { type: String, default: '' },

  // ---- Stat block ----
  armorClass: { type: Number, default: 10 },
  armorClassNote: { type: String, default: '' },
  hitPoints: {
    type: new mongoose.Schema(
      {
        average: { type: Number, default: 1 },
        formula: { type: String, default: '' },
      },
      { _id: false }
    ),
    default: () => ({}),
  },
  initiativeMod: { type: Number, default: 0 },
  initiativePassive: { type: Number, default: 10 },
  speeds: { type: [speedSchema], default: () => [{ kind: 'walk', feet: 30, notes: '' }] },
  abilities: {
    type: new mongoose.Schema(
      {
        str: { type: abilityScoreSchema, default: () => ({}) },
        dex: { type: abilityScoreSchema, default: () => ({}) },
        con: { type: abilityScoreSchema, default: () => ({}) },
        int: { type: abilityScoreSchema, default: () => ({}) },
        wis: { type: abilityScoreSchema, default: () => ({}) },
        cha: { type: abilityScoreSchema, default: () => ({}) },
      },
      { _id: false }
    ),
    default: () => ({}),
  },
  skills: { type: [skillSchema], default: [] },
  resistances: { type: [String], default: [] },
  immunities: { type: [String], default: [] },
  vulnerabilities: { type: [String], default: [] },
  conditionImmunities: { type: [String], default: [] },
  senses: { type: [senseSchema], default: [] },
  passivePerception: { type: Number, default: 10 },
  languages: { type: [String], default: [] },
  cr: { type: crSchema, default: () => ({}) },
  features: { type: [featureSchema], default: [] },

  // ---- Cartyx additions ----
  picture: { type: String, default: '' },
  pictureCrop: { type: pictureCropSchema, default: null },
  links: { type: [linkSchema], default: [] },
  gmNotes: { type: String, default: '' },
  tags: { type: [String], default: [] },
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', default: null },
  color: { type: String, default: '#9ca3af' }, // editable per the open-question answer
  source: { type: String, enum: ['srd', 'custom'], default: 'custom' },
  isHomebrew: { type: Boolean, default: false },

  // ---- Ownership ----
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

monsterSchema.pre('save', function () {
  this.updatedAt = new Date();
});

monsterSchema.pre('findOneAndUpdate', function () {
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
    if (!hasSetStage) update.push({ $set: { updatedAt: new Date() } });
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
if (typeof (monsterSchema as { index?: unknown }).index === 'function') {
  monsterSchema.index({ campaignId: 1, updatedAt: -1 });
  monsterSchema.index({ campaignId: 1, name: 1 });
  monsterSchema.index({ campaignId: 1, tags: 1 });
  monsterSchema.index({ campaignId: 1, sessionId: 1 });
  monsterSchema.index({ campaignId: 1, 'cr.value': 1 });
  monsterSchema.index({ name: 'text', 'features.description': 'text' });
}

export const Monster = mongoose.models.Monster || mongoose.model('Monster', monsterSchema);
