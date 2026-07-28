import mongoose, { type InferSchemaType, type Model } from 'mongoose';
import { normalizeTags } from '~/server/utils/helpers';

const giverSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['character', 'player', 'organization'], required: true },
    id: { type: mongoose.Schema.Types.ObjectId, required: true },
  },
  { _id: false }
);

const questLinkSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ['character', 'player', 'location', 'organization'],
      required: true,
    },
    id: { type: mongoose.Schema.Types.ObjectId, required: true },
    role: { type: String, default: '' },
    publicInfo: { type: String, default: '' },
    privateInfo: { type: String, default: '' },
  },
  { _id: false }
);

const questEventLinkSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
    role: { type: String, default: '' },
    publicInfo: { type: String, default: '' },
    privateInfo: { type: String, default: '' },
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

const questSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, default: '' },
  status: {
    type: String,
    enum: ['not_started', 'active', 'on_hold', 'completed', 'failed'],
    default: 'not_started',
  },
  publicInfo: { type: String, default: '' },
  privateInfo: { type: String, default: '' },
  isPublic: { type: Boolean, default: false },
  giver: { type: giverSchema, default: null },
  parentQuestId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quest', default: null },
  links: { type: [questLinkSchema], default: [] },
  events: { type: [questEventLinkSchema], default: [] },
  images: { type: [imageSchema], default: [] },
  tags: { type: [String], default: [] },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

questSchema.pre('save', function () {
  if (this.isModified('tags')) {
    this.tags = normalizeTags(this.tags as string[]);
  }
  this.updatedAt = new Date();
});

// istanbul ignore next
if (typeof (questSchema as { index?: unknown }).index === 'function') {
  questSchema.index({ campaignId: 1 });
  questSchema.index({ campaignId: 1, updatedAt: -1 });
  questSchema.index({ createdBy: 1 });
  questSchema.index({ tags: 1 });
  questSchema.index({ isPublic: 1 });
  questSchema.index({ status: 1 });
  questSchema.index({ parentQuestId: 1 });
  questSchema.index({ 'giver.id': 1 });
  questSchema.index({ 'links.id': 1 });
  questSchema.index({ 'events.eventId': 1 });
  questSchema.index({ name: 'text', publicInfo: 'text' });
}

export type IQuest = InferSchemaType<typeof questSchema>;

export const Quest: Model<IQuest> =
  (mongoose.models.Quest as Model<IQuest>) || mongoose.model<IQuest>('Quest', questSchema);
