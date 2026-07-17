import mongoose, { type InferSchemaType, type Model } from 'mongoose';

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

const privateWindowSchema = new mongoose.Schema(
  {
    surface: { type: String, enum: ['tabletop', 'gmscreen'], required: true },
    screenId: { type: mongoose.Schema.Types.ObjectId, required: true },
    collection: { type: String, required: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, required: true },
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    zIndex: { type: Number, default: 0 },
    state: { type: String, enum: ['open', 'minimized', 'hidden'], default: 'open' },
  },
  { _id: true }
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
    /**
     * The caller's active GM screen. Mirrors activeScreenId, which covers the
     * Tabletop only. Lives here (rather than on a GM-screens model) because
     * GMScreen is campaign-scoped and shared between co-GMs, while this is
     * per-user — despite the model's tabletop-flavoured name.
     */
    activeGMScreenId: { type: mongoose.Schema.Types.ObjectId, default: null },
    /**
     * Windows only this user can see, across BOTH surfaces (see `surface`).
     * Distinct from TabletopScreen.windows[], which is shared and broadcast.
     */
    privateWindows: { type: [privateWindowSchema], default: [] },
  },
  { collection: 'tabletopplayerstate' }
);

tabletopPlayerStateSchema.index({ campaignId: 1, userId: 1 }, { unique: true });

export type ITabletopPlayerState = InferSchemaType<typeof tabletopPlayerStateSchema>;

export const TabletopPlayerState: Model<ITabletopPlayerState> =
  (mongoose.models.TabletopPlayerState as Model<ITabletopPlayerState>) ||
  mongoose.model<ITabletopPlayerState>('TabletopPlayerState', tabletopPlayerStateSchema);
