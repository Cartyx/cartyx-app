import mongoose from 'mongoose';

const scaleSchema = new mongoose.Schema(
  {
    gridType: {
      type: String,
      enum: ['square', 'hex', 'gridless'],
      default: 'square',
    },
    pixelsPerSquare: { type: Number, default: 50 },
    feetPerSquare: { type: Number, default: 5 },
  },
  { _id: false }
);

const gridOverlaySchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    color: { type: String, default: '#ffffff66' },
  },
  { _id: false }
);

const mapSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: { type: String, required: true },
    tags: { type: [String], default: [] },
    imageKey: { type: String, required: true },
    imageUrl: { type: String, required: true },
    imageWidth: { type: Number, required: true },
    imageHeight: { type: Number, required: true },
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      default: null,
    },
    scale: { type: scaleSchema, default: () => ({}) },
    gridOverlay: { type: gridOverlaySchema, default: () => ({}) },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'map' }
);

// istanbul ignore next
if (typeof (mapSchema as { index?: unknown }).index === 'function') {
  mapSchema.index({ campaignId: 1, updatedAt: -1 });
  mapSchema.index({ campaignId: 1, locationId: 1 });
  mapSchema.index({ campaignId: 1, name: 1 }, { unique: true });
}

export const Map = mongoose.models.Map || mongoose.model('Map', mapSchema);
