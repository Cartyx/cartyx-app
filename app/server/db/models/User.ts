import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  email: { type: String, unique: true, sparse: true },
  role: { type: String, enum: ['gm', 'player', 'unknown'], default: 'unknown', index: true },
  provider: String,
  providerId: { type: String, unique: true, sparse: true },
  firstName: String,
  lastName: String,
  avatarUrl: String,
  campaigns: [{ campaignId: mongoose.Schema.Types.ObjectId, joinedAt: Date, status: String }],
  // Per-user UI preferences that persist across campaigns/sessions.
  preferences: {
    // Measurement (ruler) line color, a 6-digit hex string (e.g. '#fbbf24').
    rulerColor: { type: String },
  },
  lastLoginAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
});

export const User = mongoose.models.User || mongoose.model('User', userSchema);
