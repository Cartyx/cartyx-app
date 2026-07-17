import mongoose, { type InferSchemaType, type Model } from 'mongoose';
import { TOKEN_SOURCES } from '~/types/schemas/mapTokens';

const mapTokenSchema = new mongoose.Schema(
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
    sourceCollection: {
      type: String,
      // Derived from the shared schema so the model and Zod validator can't drift.
      enum: [...TOKEN_SOURCES],
      required: true,
    },
    sourceDocumentId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    // Per-(map, source entity) instance number for sources that can appear more
    // than once on a map (monsters: Goblin A, Goblin B …). Unset/null for
    // players and characters, which remain unique per entity.
    instanceNumber: { type: Number, default: null },
    // Populated for player-owned tokens so we can gate movement.
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // Position in MAP-LOCAL pixel coordinates (the image's native pixel space).
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    sizeSquares: { type: Number, default: 1 },
    color: { type: String, default: '#3498db' },
    label: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    labelVisible: { type: Boolean, default: true },
    hiddenFromPlayers: { type: Boolean, default: false },
    zIndex: { type: Number, default: 0 },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'mapToken' }
);

// istanbul ignore next
if (typeof (mapTokenSchema as { index?: unknown }).index === 'function') {
  mapTokenSchema.index({ mapId: 1 });
  // Unique per (map, source entity, instance). Players/characters leave
  // instanceNumber null → at most one per entity (re-drop refocuses, not
  // duplicates). Monsters get distinct instance numbers → many per entity.
  mapTokenSchema.index(
    { mapId: 1, sourceCollection: 1, sourceDocumentId: 1, instanceNumber: 1 },
    { unique: true }
  );
}

export type IMapToken = InferSchemaType<typeof mapTokenSchema>;

export const MapToken: Model<IMapToken> =
  (mongoose.models.MapToken as Model<IMapToken>) ||
  mongoose.model<IMapToken>('MapToken', mapTokenSchema);
