const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('No MONGODB_URI'); process.exit(1); }

// Must match the real app's User schema (app/server/db/models/User.ts) so the
// GM lands in the `users` collection with a `role: 'gm'` field — that's what
// both `scripts/dev_seed.py` and `e2e/globalSetup.ts` look up via
// `db.users.findOne({ role: 'gm' })`. (A prior version wrote a `GameMaster`
// model → `gamemasters` collection with no `role`, so a fresh DB never had a
// queryable GM and `dev:seed` / e2e bootstrap failed with "No GM user found".)
const userSchema = new mongoose.Schema({
  email:       { type: String, required: true, unique: true },
  role:        { type: String, enum: ['gm', 'player', 'unknown'], default: 'unknown', index: true },
  firstName:   String,
  lastName:    String,
  provider:    String,
  providerId:  { type: String, unique: true, sparse: true },
  avatarPath:  String,
  avatarUrl:   String,
  campaigns:   [{ campaignId: mongoose.Schema.Types.ObjectId, joinedAt: Date, status: String }],
  lastLoginAt: Date,
  createdAt:   { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

async function seed() {
  // Honor MONGODB_DB the same way dev_seed.py and globalSetup.ts do, so all
  // three target the same database (e.g. cartyx_e2e in CI). Without this the
  // GM would be written to the URI's default database instead.
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB });
  const gm = await User.findOneAndUpdate(
    { email: 'alabeau@gmail.com' },
    {
      email: 'alabeau@gmail.com',
      role: 'gm',
      firstName: 'Aaron',
      lastName: 'LaBeau',
      provider: 'google',
      // Needed by e2e/globalSetup.ts to mint the test session JWT.
      providerId: 'seed-gm-alabeau',
    },
    // `new: true` alongside `returnDocument: 'after'` matches the repo
    // convention (and upsertUser) so the post-update doc is returned reliably
    // across Mongoose versions — otherwise `gm` could be the pre-upsert null.
    { upsert: true, returnDocument: 'after', new: true }
  );
  console.log('✅ GM seeded:', gm.email, '| role:', gm.role, '|', gm._id.toString());
  await mongoose.disconnect();
}
seed().catch(e => { console.error(e); process.exit(1); });
