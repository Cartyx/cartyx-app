import mongoose, { type InferSchemaType, type Model } from 'mongoose';
import { WINDOW_STATES } from '~/types/gmscreen';

// ---------------------------------------------------------------------------
// Constants – practical guardrails for embedded arrays
// ---------------------------------------------------------------------------
export const GMSCREEN_LIMITS = {
  MAX_WINDOWS: 20,
  MAX_STACKS: 10,
  MAX_STACK_ITEMS: 50,
} as const;

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

const windowSchema = new mongoose.Schema(
  {
    collection: { type: String, required: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, required: true },
    state: {
      type: String,
      enum: WINDOW_STATES,
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

const stackItemSchema = new mongoose.Schema(
  {
    collection: { type: String, required: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, required: true },
    label: { type: String, default: '' },
  },
  { _id: true }
);

const stackSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    x: { type: Number, default: null },
    y: { type: Number, default: null },
    items: {
      type: [stackItemSchema],
      default: [],
      validate: {
        validator: (v: unknown) => Array.isArray(v) && v.length <= GMSCREEN_LIMITS.MAX_STACK_ITEMS,
        message: `A stack cannot contain more than ${GMSCREEN_LIMITS.MAX_STACK_ITEMS} items.`,
      },
    },
  },
  { _id: true }
);

// ---------------------------------------------------------------------------
// Main GMScreen schema
// ---------------------------------------------------------------------------

const gmScreenSchema = new mongoose.Schema(
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
    windows: {
      type: [windowSchema],
      default: [],
      validate: {
        validator: (v: unknown) => Array.isArray(v) && v.length <= GMSCREEN_LIMITS.MAX_WINDOWS,
        message: `A screen cannot contain more than ${GMSCREEN_LIMITS.MAX_WINDOWS} windows.`,
      },
    },
    stacks: {
      type: [stackSchema],
      default: [],
      validate: {
        validator: (v: unknown) => Array.isArray(v) && v.length <= GMSCREEN_LIMITS.MAX_STACKS,
        message: `A screen cannot contain more than ${GMSCREEN_LIMITS.MAX_STACKS} stacks.`,
      },
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'gmscreen' }
);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

// istanbul ignore next
if (typeof (gmScreenSchema as { index?: unknown }).index === 'function') {
  gmScreenSchema.index({ campaignId: 1, tabOrder: 1 }, { unique: true });
  gmScreenSchema.index({ campaignId: 1, name: 1 }, { unique: true });
}

export type IGMScreen = InferSchemaType<typeof gmScreenSchema>;

export const GMScreen: Model<IGMScreen> =
  (mongoose.models.GMScreen as Model<IGMScreen>) ||
  mongoose.model<IGMScreen>('GMScreen', gmScreenSchema);
