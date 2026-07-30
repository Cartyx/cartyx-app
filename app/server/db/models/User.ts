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
  // The user's private namespace in R2 for audio objects: 32 lowercase hex
  // characters (128 bits), minted lazily on the FIRST audio upload and never
  // rewritten. Every audio key this user owns lives under
  // `uploads/audio/<audioStoragePrefix>/`, which is what makes
  // `~/server/functions/audio-cleanup.ts` owner-scoped by construction rather
  // than by filtering: `ListObjectsV2` with that prefix cannot return another
  // user's object, because the S3 API itself will not.
  //
  // RANDOM, not the `_id`, and that is the whole point. An audio key becomes
  // the object's public CDN URL (`publicUrl = ${cdnUrl}/${key}`), so a path
  // segment carrying the user's ObjectId would let anyone holding one shared
  // link enumerate-by-correlation every other track that user owns. This
  // segment carries no identity and is not derivable from one.
  //
  // Minted lazily rather than backfilled: a user who never uploads audio has
  // no namespace and needs none. It must never be regenerated — the prefix is
  // the only path to that user's existing objects, so a new one strands all of
  // them. `resolveAudioStoragePrefix` enforces that with a conditional write.
  audioStoragePrefix: { type: String, unique: true, sparse: true },
  lastLoginAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
});

export type IUser = InferSchemaType<typeof userSchema>;

export const User: Model<IUser> =
  (mongoose.models.User as Model<IUser>) || mongoose.model<IUser>('User', userSchema);
