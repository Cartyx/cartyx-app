import mongoose from 'mongoose';
import { GRID_STYLES, TABLETOP_MODES } from '~/types/tabletop';

export const TABLETOP_LIMITS = {
  MAX_WINDOWS: 20,
} as const;

const windowSchema = new mongoose.Schema(
  {
    collection: { type: String, required: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, required: true },
    state: {
      type: String,
      enum: ['open', 'minimized', 'hidden'],
      default: 'open',
    },
    x: { type: Number, default: null },
    y: { type: Number, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    zIndex: { type: Number, default: 0 },
  },
  { _id: true }
);

const tabletopScreenSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
    },
    name: { type: String, required: true },
    tabOrder: { type: Number, default: 0 },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    mode: {
      type: String,
      enum: TABLETOP_MODES,
      default: 'grid',
    },
    gridStyle: {
      type: String,
      enum: GRID_STYLES,
      default: 'dark',
    },
    gridSize: { type: Number, default: 50 },
    gridVisible: { type: Boolean, default: true },
    gridScale: { type: Number, default: 5 },
    locationId: { type: mongoose.Schema.Types.ObjectId, default: null },
    battleMapImage: { type: String, default: null },
    windows: {
      type: [windowSchema],
      default: [],
      validate: {
        validator: (v: unknown) => Array.isArray(v) && v.length <= TABLETOP_LIMITS.MAX_WINDOWS,
        message: `A screen cannot contain more than ${TABLETOP_LIMITS.MAX_WINDOWS} windows.`,
      },
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'tabletopscreen' }
);

tabletopScreenSchema.index({ campaignId: 1, tabOrder: 1 }, { unique: true });
tabletopScreenSchema.index({ campaignId: 1, name: 1 }, { unique: true });

export const TabletopScreen =
  mongoose.models.TabletopScreen || mongoose.model('TabletopScreen', tabletopScreenSchema);
