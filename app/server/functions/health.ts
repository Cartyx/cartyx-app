import mongoose from 'mongoose';
import { connectDB, isDBConnected } from '../db/connection';
import { withLogging } from '../utils/logger';

/**
 * Circuit-breaker recovery probe. Must reflect real backend health: a probe
 * that skipped the DB would close the breaker while every DB-dependent
 * endpoint still fails, causing open/close flapping.
 */
export const healthCheck = withLogging('health.healthCheck', async (): Promise<{ ok: true }> => {
  await connectDB();
  // status: 503 is harmless and useful for in-process/server-side callers,
  // but it does not survive server-fn serialization to the client — the
  // client-side classifier matches on the "database not connected" message.
  if (!isDBConnected()) throw Object.assign(new Error('Database not connected'), { status: 503 });
  const db = mongoose.connection.db;
  if (!db) throw Object.assign(new Error('Database not connected'), { status: 503 });
  await db.admin().command({ ping: 1 });
  return { ok: true };
});
