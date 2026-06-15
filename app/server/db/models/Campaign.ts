import mongoose from 'mongoose';

const campaignSchema = new mongoose.Schema({
  gameMasterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  name: { type: String, required: true },
  description: String,
  imagePath: String,
  schedule: { frequency: String, dayOfWeek: String, time: String, timezone: String },
  links: [{ name: String, url: String }],
  maxPlayers: { type: Number, default: 4 },
  inviteCode: { type: String, unique: true, sparse: true },
  status: { type: String, default: 'active' },
  // NOTE: the active map is per-tab (TabletopScreen.activeMapId), not per
  // campaign. There is intentionally no campaign-level activeMapId.
  members: [
    {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      role: { type: String, enum: ['gm', 'player'], default: 'player' },
      joinedAt: { type: Date, default: Date.now },
    },
  ],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// istanbul ignore next
if (typeof (campaignSchema as { index?: unknown }).index === 'function') {
  campaignSchema.index({ 'members.userId': 1 });
}

export const Campaign = mongoose.models.Campaign || mongoose.model('Campaign', campaignSchema);
