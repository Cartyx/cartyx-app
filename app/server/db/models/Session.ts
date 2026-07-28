import mongoose, { type InferSchemaType, type Model, type HydratedDocument } from 'mongoose';

const sessionSchema = new mongoose.Schema({
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
  name: { type: String, required: true },
  gm: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  number: { type: Number, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date },
  status: { type: String, enum: ['not_started', 'active', 'completed'], default: 'not_started' },
  summary: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// istanbul ignore next
if (typeof (sessionSchema as { index?: unknown }).index === 'function') {
  sessionSchema.index({ campaignId: 1, number: -1 });
  sessionSchema.index({ campaignId: 1, startDate: -1 });
  sessionSchema.index(
    { campaignId: 1, status: 1 },
    {
      unique: true,
      partialFilterExpression: { status: 'active' },
    }
  );
}

export type ISession = InferSchemaType<typeof sessionSchema>;
export type SessionDoc = HydratedDocument<ISession>;

export const Session: Model<ISession> =
  (mongoose.models.Session as Model<ISession>) ||
  mongoose.model<ISession>('Session', sessionSchema);
