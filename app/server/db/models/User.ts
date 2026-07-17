import mongoose, { type InferSchemaType, type Model } from 'mongoose';

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
  // Provider OAuth tokens, encrypted at rest (AES-256-GCM). Kept server-side
  // only (never in the session cookie) and `select: false` so they are never
  // returned by normal queries — only explicitly via `.select('+oauthTokens')`.
  // Used at logout time to revoke the provider grant.
  oauthTokens: {
    type: {
      accessToken: {
        ciphertext: String,
        iv: String,
        authTag: String,
      },
      refreshToken: {
        ciphertext: String,
        iv: String,
        authTag: String,
      },
    },
    select: false,
    _id: false,
  },
  lastLoginAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
});

export type IUser = InferSchemaType<typeof userSchema>;

export const User: Model<IUser> =
  (mongoose.models.User as Model<IUser>) || mongoose.model<IUser>('User', userSchema);
