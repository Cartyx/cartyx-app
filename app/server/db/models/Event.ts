import mongoose, { type InferSchemaType, type Model } from 'mongoose';
import { normalizeTags } from '~/server/utils/helpers';

const linkSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ['character', 'player', 'race', 'location', 'lore'],
      required: true,
    },
    id: { type: mongoose.Schema.Types.ObjectId, required: true },
  },
  { _id: false }
);
const cropSchema = new mongoose.Schema(
  { x: Number, y: Number, width: Number, height: Number },
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
const calDateSchema = new mongoose.Schema(
  { year: Number, monthIndex: Number, day: Number },
  { _id: false }
);

const eventSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, default: '' },
  gmContent: { type: String, default: '' },
  isPublic: { type: Boolean, default: false },
  isEpic: { type: Boolean, default: false },
  start: { type: calDateSchema, required: true },
  end: { type: calDateSchema, default: null },
  startOrdinal: { type: Number, required: true },
  endOrdinal: { type: Number, required: true },
  links: { type: [linkSchema], default: [] },
  sessionId: { type: mongoose.Schema.Types.ObjectId, default: null },
  images: { type: [imageSchema], default: [] },
  tags: { type: [String], default: [] },
  color: { type: String, default: null },
  campaignId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  calendarId: { type: mongoose.Schema.Types.ObjectId, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// istanbul ignore next
if (typeof (eventSchema as { index?: unknown }).index === 'function') {
  eventSchema.index({ campaignId: 1, startOrdinal: 1 });
  eventSchema.index({ isPublic: 1 });
  eventSchema.index({ isEpic: 1 });
  eventSchema.index({ 'links.id': 1 });
  eventSchema.index({ tags: 1 });
  eventSchema.index({ sessionId: 1 });
  eventSchema.index({ title: 'text', content: 'text' });
}

eventSchema.pre('save', function () {
  if (this.isModified('tags')) this.tags = normalizeTags(this.tags as string[]);
  this.updatedAt = new Date();
});

export type IEvent = InferSchemaType<typeof eventSchema>;

export const Event: Model<IEvent> =
  (mongoose.models.Event as Model<IEvent>) || mongoose.model<IEvent>('Event', eventSchema);
