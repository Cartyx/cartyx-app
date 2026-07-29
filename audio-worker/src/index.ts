import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { logger } from './logger.js';
import { claimNext, reapStale, type ClaimModel } from './claim.js';
import { readWorkerTimings } from './config.js';
import { processAsset, makeSourceDeleter, type Model } from './process.js';
import { beat } from './heartbeat.js';
import { captureException } from './telemetry.js';

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
  // Before the connect, not after: the liveness probe treats a missing
  // heartbeat as dead, and a `mongoose.connect` that never resolves is itself a
  // wedge worth restarting. Writing it here means the probe's clock starts at
  // process start rather than at first success.
  beat();
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
  // The reaper needs to delete the R2 objects of uploads abandoned before
  // confirm — see reapStale. Built here because process.ts owns the R2 client.
  const deleteSource = makeSourceDeleter();

  while (running) {
    try {
      beat();
      await reapStale(model, STALE_MS, UPLOAD_STALE_MS, deleteSource);
      const asset = await claimNext<{ _id: unknown; sourceKey?: string; attempts?: number }>(
        model,
        WORKER_ID
      );
      if (!asset) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        continue;
      }
      await processAsset(model, asset, WORKER_ID);
    } catch (err) {
      logger.error({ err }, 'worker loop error');
      captureException(err, { workerId: WORKER_ID, scope: 'loop' });
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }

  await mongoose.disconnect();
  logger.info('audio worker stopped');
}

main().catch((err) => {
  logger.error({ err }, 'fatal');
  captureException(err, { workerId: WORKER_ID, scope: 'fatal' });
  // A beat of grace for the report to leave the process — the POST is
  // fire-and-forget, and process.exit would otherwise discard it.
  // (Not unref'd: unref would let the process fall out of the event loop and
  // exit 0, reporting a fatal crash to Kubernetes as a clean shutdown.)
  setTimeout(() => process.exit(1), 500);
});
