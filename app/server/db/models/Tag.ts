import mongoose, { type InferSchemaType, type Model } from 'mongoose';

const tagSchema = new mongoose.Schema({
  name: { type: String, required: true },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// istanbul ignore next
if (typeof (tagSchema as { index?: unknown }).index === 'function') {
  tagSchema.index({ campaignId: 1, name: 1 }, { unique: true });
  tagSchema.index({ campaignId: 1 });
}

export type ITag = InferSchemaType<typeof tagSchema>;

export const Tag: Model<ITag> =
  (mongoose.models.Tag as Model<ITag>) || mongoose.model<ITag>('Tag', tagSchema);
