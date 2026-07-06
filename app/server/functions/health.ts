import mongoose from 'mongoose';
import { connectDB, isDBConnected } from '../db/connection';

/**
 * Circuit-breaker recovery probe. Must reflect real backend health: a probe
 * that skipped the DB would close the breaker while every DB-dependent
 * endpoint still fails, causing open/close flapping.
 */
export async function healthCheck(): Promise<{ ok: true }> {
  await connectDB();
  if (!isDBConnected()) throw Object.assign(new Error('Database not connected'), { status: 503 });
  const db = mongoose.connection.db;
  if (!db) throw Object.assign(new Error('Database not connected'), { status: 503 });
  await db.admin().command({ ping: 1 });
  return { ok: true };
}
