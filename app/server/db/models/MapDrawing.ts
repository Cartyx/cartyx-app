import mongoose from 'mongoose';

// Freeform drawing placed on a map by a player or GM (pencil stroke, rectangle,
// or ellipse). Any member can create a drawing; modification (resize/delete) is
// gated to the author (createdBy) or any GM. All geometry is in MAP-LOCAL pixel
// coordinates (the image's native pixel space), rendered scaled by the viewport.
const mapDrawingSchema = new mongoose.Schema(
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
    // 'pencil' → freeform polyline (points); 'rect'/'ellipse' → bounding box.
    kind: { type: String, enum: ['pencil', 'rect', 'ellipse'], required: true },
    color: { type: String, default: '#e74c3c' },
    // Line/stroke width in map-local pixels (rendered scaled by the viewport).
    strokeWidth: { type: Number, default: 4 },
    // Filled vs. outline (rect/ellipse only; ignored for pencil).
    filled: { type: Boolean, default: false },
    // Pencil: flattened [x0, y0, x1, y1, …] map-local points. Empty otherwise.
    points: { type: [Number], default: [] },
    // Bounding box for rect/ellipse (map-local pixels). Zero for pencil.
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    // The author. Used to gate modification: a player may resize/delete only
    // their own drawing; a GM may modify anyone's.
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'mapDrawing' }
);

// istanbul ignore next
if (typeof (mapDrawingSchema as { index?: unknown }).index === 'function') {
  // Queries always filter by (mapId, campaignId), so index the compound shape.
  mapDrawingSchema.index({ mapId: 1, campaignId: 1 });
}

export const MapDrawing =
  mongoose.models.MapDrawing || mongoose.model('MapDrawing', mapDrawingSchema);
