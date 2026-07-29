import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { logger } from './logger.js';
import { claimNext, reapStale } from './claim.js';
import { processAsset } from './process.js';

const WORKER_ID = `worker-${randomUUID().slice(0, 8)}`;
const POLL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5000);
const STALE_MS = Number(process.env.CLAIM_TIMEOUT_MS ?? 600_000);

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

  const model = mongoose.connection.collection('audioassets') as never;

  while (running) {
    try {
      await reapStale(model, STALE_MS);
      const asset = await claimNext<{ _id: unknown; sourceKey?: string }>(model, WORKER_ID);
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
