import mongoose from 'mongoose';

// Spell area-of-effect template on a map. Any member can create an AoE;
// deletion is gated to the author (createdBy) or any GM.
const mapAoESchema = new mongoose.Schema(
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
    // Shape of the area-of-effect.
    shape: { type: String, required: true },
    // Origin in map-local pixel coordinates (the image's native pixel space).
    // Center for sphere/cube/cylinder, apex for cone/line.
    originX: { type: Number, required: true },
    originY: { type: Number, required: true },
    // Radius / length / edge, in map-local pixels.
    sizePx: { type: Number, required: true },
    // Line width / cylinder height, in map-local pixels (optional).
    widthPx: { type: Number },
    // Aim in radians (cone/line); 0 for radial shapes.
    rotation: { type: Number, required: true },
    // 6-digit hex color.
    color: { type: String, required: true },
    // The author. Used to gate deletion: a player may delete only their own
    // AoE; a GM may delete anyone's.
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'mapAoE' }
);

// istanbul ignore next
if (typeof (mapAoESchema as { index?: unknown }).index === 'function') {
  // Queries always filter by (campaignId, mapId), so index the compound shape.
  mapAoESchema.index({ campaignId: 1, mapId: 1 });
}

export const MapAoE = mongoose.models.MapAoE || mongoose.model('MapAoE', mapAoESchema);
