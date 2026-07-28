import mongoose, { type InferSchemaType, type Model } from 'mongoose';

// Freeform text written on a map by a player or GM. Any member can create
// text; deletion is gated to the author (createdBy) or any GM.
const mapTextSchema = new mongoose.Schema(
  {
    mapId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Map',
      required: true,
    },
    // Denormalised for cheap auth checks (avoids a Map lookup per write).
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
    },
    // Position in MAP-LOCAL pixel coordinates (the image's native pixel space).
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    text: { type: String, required: true },
    color: { type: String, default: '#fbbf24' },
    // Font size in map-local pixels (rendered scaled by the viewport).
    fontSize: { type: Number, default: 16 },
    // The author. Used to gate deletion: a player may delete only their own
    // text; a GM may delete anyone's.
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'mapText' }
);

// istanbul ignore next
if (typeof (mapTextSchema as { index?: unknown }).index === 'function') {
  // Queries always filter by (mapId, campaignId), so index the compound shape.
  mapTextSchema.index({ mapId: 1, campaignId: 1 });
}

export type IMapText = InferSchemaType<typeof mapTextSchema>;

export const MapText: Model<IMapText> =
  (mongoose.models.MapText as Model<IMapText>) ||
  mongoose.model<IMapText>('MapText', mapTextSchema);
