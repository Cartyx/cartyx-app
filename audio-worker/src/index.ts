import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { logger } from './logger.js';
import { claimNext, reapStale, type ClaimModel } from './claim.js';
import { readWorkerTimings } from './config.js';
import { processAsset, type Model } from './process.js';

const WORKER_ID = `worker-${randomUUID().slice(0, 8)}`;
// Parsed in config.ts, not inline here: this module calls main() at import
// time, so anything read inline is untestable — and the naive
// `Number(process.env.X ?? default)` silently yields 0 for the empty string
// Helm renders for a missing values.yaml key. See envMs.
const { pollMs: POLL_MS, staleMs: STALE_MS, uploadStaleMs: UPLOAD_STALE_MS } = readWorkerTimings();

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
