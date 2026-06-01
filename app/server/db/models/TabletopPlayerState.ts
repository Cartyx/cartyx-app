import mongoose from 'mongoose';

const viewportSchema = new mongoose.Schema(
  {
    screenId: { type: mongoose.Schema.Types.ObjectId, required: true },
    zoom: { type: Number, default: 1 },
    panX: { type: Number, default: 0 },
    panY: { type: Number, default: 0 },
  },
  { _id: false }
);

const windowOverrideSchema = new mongoose.Schema(
  {
    windowId: { type: String, required: true },
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    state: {
      type: String,
      enum: ['open', 'minimized', 'hidden'],
      default: 'open',
    },
  },
  { _id: false }
);

const tabletopPlayerStateSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    activeScreenId: { type: mongoose.Schema.Types.ObjectId, default: null },
    viewports: { type: [viewportSchema], default: [] },
    windowOverrides: { type: [windowOverrideSchema], default: [] },
  },
  { collection: 'tabletopplayerstate' }
);

tabletopPlayerStateSchema.index({ campaignId: 1, userId: 1 }, { unique: true });

export const TabletopPlayerState =
  mongoose.models.TabletopPlayerState ||
  mongoose.model('TabletopPlayerState', tabletopPlayerStateSchema);
