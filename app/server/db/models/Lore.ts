import mongoose from 'mongoose';
import { normalizeTags } from '~/server/utils/helpers';

const linkSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['race', 'character', 'player', 'location'], required: true },
    id: { type: mongoose.Schema.Types.ObjectId, required: true },
  },
  { _id: false }
);

const cropSchema = new mongoose.Schema(
  {
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
  },
  { _id: false }
);

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    caption: { type: String, default: '' },
    crop: { type: cropSchema, default: null },
  },
  { _id: false }
);

const loreSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, default: '' },
  gmContent: { type: String, default: '' },
  isPublic: { type: Boolean, default: false },
  images: { type: [imageSchema], default: [] },
  links: { type: [linkSchema], default: [] },
  tags: { type: [String], default: [] },
  campaignId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// istanbul ignore next
if (typeof (loreSchema as { index?: unknown }).index === 'function') {
  loreSchema.index({ campaignId: 1, updatedAt: -1 });
  loreSchema.index({ isPublic: 1 });
  loreSchema.index({ tags: 1 });
  loreSchema.index({ 'links.id': 1 });
  loreSchema.index({ title: 'text', content: 'text' });
}

loreSchema.pre('save', function () {
  if (this.isModified('tags')) {
    this.tags = normalizeTags(this.tags as string[]);
  }
  this.updatedAt = new Date();
});

export const Lore = mongoose.models.Lore || mongoose.model('Lore', loreSchema);
