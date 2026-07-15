import mongoose from 'mongoose';

const locationSchema = new mongoose.Schema(
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
    locationType: { type: String, required: true },
    description: { type: String, default: '' },
    gmNotes: { type: String, default: '' },
    isPublic: { type: Boolean, default: true },
    parentLocations: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Location' }],
    childLocations: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Location' }],
    mapImage: { type: String, default: null },
    mapBounds: {
      type: new mongoose.Schema(
        {
          north: { type: Number, required: true },
          south: { type: Number, required: true },
          east: { type: Number, required: true },
          west: { type: Number, required: true },
        },
        { _id: false }
      ),
      default: null,
    },
    images: [
      new mongoose.Schema(
        {
          imageKey: { type: String, required: true },
          url: { type: String, required: true },
          title: { type: String, required: true },
          uploadedAt: { type: Date, default: Date.now },
        },
        { _id: false }
      ),
    ],
    tags: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'location' }
);

// istanbul ignore next
if (typeof (locationSchema as { index?: unknown }).index === 'function') {
  locationSchema.index({ campaignId: 1, updatedAt: -1 });
  locationSchema.index({ campaignId: 1, locationType: 1 });
  locationSchema.index({ campaignId: 1, isPublic: 1 });
  locationSchema.index({ tags: 1 });
  locationSchema.index({ name: 'text', description: 'text' });
}

export const Location = mongoose.models.Location || mongoose.model('Location', locationSchema);
