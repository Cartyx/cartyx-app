import mongoose from 'mongoose';
import { SESSION_EVENT_TYPES } from '~/types/tabletop';

const sessionEventSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
      required: true,
    },
    timestamp: { type: Date, default: Date.now },
    eventType: {
      type: String,
      enum: SESSION_EVENT_TYPES,
      required: true,
    },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    collection: { type: String, required: true },
    tabletopScreenId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TabletopScreen',
      required: true,
    },
    triggeredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    displayName: { type: String, required: true },
  },
  { collection: 'sessionevent' }
);

sessionEventSchema.index({ campaignId: 1, sessionId: 1, timestamp: 1 });

export const SessionEvent =
  mongoose.models.SessionEvent || mongoose.model('SessionEvent', sessionEventSchema);
