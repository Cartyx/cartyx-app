import mongoose from 'mongoose';

export const DEFAULT_LOCATION_TYPES = [
  'continent',
  'country',
  'region',
  'state',
  'province',
  'city',
  'town',
  'village',
  'cave',
  'dungeon',
  'planet',
] as const;

const locationTypeSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
    },
    name: { type: String, required: true },
    isDefault: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
  },
  { collection: 'locationtype' }
);

locationTypeSchema.index({ campaignId: 1, name: 1 }, { unique: true });
locationTypeSchema.index({ campaignId: 1, sortOrder: 1 });

export const LocationType =
  mongoose.models.LocationType || mongoose.model('LocationType', locationTypeSchema);

/**
 * Seed default location types for a campaign if none exist.
 * Called on first listLocationTypes request.
 */
export async function seedDefaultLocationTypes(campaignId: string): Promise<void> {
  const count = await LocationType.countDocuments({ campaignId });
  if (count > 0) return;

  const docs = DEFAULT_LOCATION_TYPES.map((name, i) => ({
    campaignId,
    name,
    isDefault: true,
    sortOrder: i,
  }));

  await LocationType.insertMany(docs);
}
