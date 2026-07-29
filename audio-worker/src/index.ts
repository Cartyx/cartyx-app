import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { logger } from './logger.js';
import { claimNext, reapStale, type ClaimModel } from './claim.js';
import { processAsset, type Model } from './process.js';

const WORKER_ID = `worker-${randomUUID().slice(0, 8)}`;
const POLL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5000);
const STALE_MS = Number(process.env.CLAIM_TIMEOUT_MS ?? 600_000);
// Presigned PUT URLs expire after 300s (app/server/functions/uploads.ts), so a
// row still `uploading` 15 minutes after creation can never be confirmed —
// nothing will ever move it again. See reapStale's doc comment.
const UPLOAD_STALE_MS = Number(process.env.UPLOAD_TIMEOUT_MS ?? 900_000);

let running = true;
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, finishing current job');
  running = false;
});

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  await mongoose.connect(uri);
  logger.info({ workerId: WORKER_ID }, 'audio worker started');

  // The real mongoose Collection's findOneAndUpdate/updateMany/updateOne are
  // structurally incompatible with ClaimModel/Model — those type their
  // filter/update params as `unknown`, which the real driver's narrower
  // param types don't satisfy under contravariance — so *some* cast is
  // required here. `as never` (the bottom type) was too wide: it disables
  // checking on `model` for the rest of this file, so a typo, a wrong
  // argument count, or a future signature change in claim.ts/process.ts
  // would all silently compile. Bridge through `unknown` to the actual
  // intersection type instead, so real drift is still caught.
  const model = mongoose.connection.collection('audioassets') as unknown as ClaimModel & Model;

  while (running) {
    try {
      await reapStale(model, STALE_MS, UPLOAD_STALE_MS);
      const asset = await claimNext<{ _id: unknown; sourceKey?: string; attempts?: number }>(
        model,
        WORKER_ID
      );
      if (!asset) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        continue;
      }
      await processAsset(model, asset);
    } catch (err) {
      logger.error({ err }, 'worker loop error');
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }

  await mongoose.disconnect();
  logger.info('audio worker stopped');
}

main().catch((err) => {
  logger.error({ err }, 'fatal');
  process.exit(1);
});
