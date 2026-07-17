import mongoose, { type InferSchemaType, type Model } from 'mongoose';

const messageSchema = new mongoose.Schema({
  id: { type: String, required: true },
  seq: { type: Number, required: true },
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session',
    required: true,
  },
  campaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    required: true,
  },
  channel: {
    type: String,
    enum: ['general', 'gm'],
    required: true,
  },
  type: {
    type: String,
    enum: ['chat', 'spell-card', 'trait', 'item'],
    required: true,
  },
  authorId: { type: String, required: true },
  authorName: { type: String, required: true },
  text: { type: String, default: '' },
  beyond20Data: {
    title: { type: String },
    source: { type: String },
    description: { type: String },
    properties: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  timestamp: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
});

// istanbul ignore next
if (typeof (messageSchema as { index?: unknown }).index === 'function') {
  messageSchema.index({ sessionId: 1, seq: 1 });
  messageSchema.index({ id: 1 }, { unique: true });
}

export type IMessage = InferSchemaType<typeof messageSchema>;

export const Message: Model<IMessage> =
  (mongoose.models.Message as Model<IMessage>) ||
  mongoose.model<IMessage>('Message', messageSchema);
