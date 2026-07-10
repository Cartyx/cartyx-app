import { z } from 'zod';
import { getSession } from '../session';
import { connectDB, isDBConnected } from '../db/connection';
import { DiceRoll } from '../db/models/DiceRoll';
import { serverCaptureException } from '../utils/posthog';
import { listDiceRollsSchema, saveDiceRollSchema } from '~/types/schemas/diceRolls';
import { requireSessionAccess } from './sessionAccess';

export const listDiceRolls = async ({ data }: { data: z.infer<typeof listDiceRollsSchema> }) => {
  try {
    const user = await getSession();
    if (!user) throw new Error('Not authenticated');

    await connectDB();
    if (!isDBConnected()) throw new Error('Database not available');
    const { isGM } = await requireSessionAccess(data.sessionId, user.id);

    const filter: Record<string, unknown> = { sessionId: data.sessionId };
    if (!isGM) {
      filter.channel = 'general';
    }
    if (data.beforeSeq !== undefined) {
      filter.seq = { $lt: data.beforeSeq };
    }

    const limit = data.limit ?? 100;

    const rolls = await DiceRoll.find(filter).sort({ seq: 1 }).limit(limit).lean();

    // Serialize to plain JSON to strip MongoDB ObjectId instances
    // (seroval cannot serialize ObjectId objects)
    return JSON.parse(
      JSON.stringify(
        (rolls as Array<Record<string, unknown>>).map((r) => ({
          id: r.id,
          seq: r.seq,
          sessionId: String(r.sessionId),
          campaignId: String(r.campaignId),
          channel: r.channel as 'general' | 'gm',
          character: r.character,
          title: r.title,
          rollType: r.rollType,
          attackRolls: r.attackRolls,
          damageRolls: r.damageRolls,
          totalDamages: r.totalDamages,
          rollInfo: r.rollInfo,
          description: r.description ?? '',
          timestamp: r.timestamp,
        }))
      )
    );
  } catch (e) {
    serverCaptureException(e, undefined, {
      action: 'listDiceRolls',
      sessionId: data.sessionId,
    });
    throw e;
  }
};

export const saveDiceRoll = async ({ data }: { data: z.infer<typeof saveDiceRollSchema> }) => {
  try {
    const user = await getSession();
    if (!user) throw new Error('Not authenticated');

    await connectDB();
    if (!isDBConnected()) throw new Error('Database not available');
    const { campaignId, isGM } = await requireSessionAccess(data.sessionId, user.id);
    if (data.campaignId !== campaignId) throw new Error('Session does not belong to campaign');
    if (data.channel === 'gm' && !isGM) throw new Error('Forbidden: GM channel requires GM role');

    await DiceRoll.updateOne(
      { id: data.id, sessionId: data.sessionId },
      {
        $set: { ...data },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );

    return { success: true };
  } catch (e) {
    serverCaptureException(e, undefined, {
      action: 'saveDiceRoll',
      messageId: data.id,
      sessionId: data.sessionId,
    });
    throw e;
  }
};
