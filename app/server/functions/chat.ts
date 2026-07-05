import { z } from 'zod';
import { getSession } from '../session';
import { connectDB, isDBConnected } from '../db/connection';
import { Message } from '../db/models/Message';
import { serverCaptureException } from '../utils/posthog';
import { listMessagesSchema, saveMessageSchema } from '~/types/schemas/chat';
import { requireSessionAccess } from './sessionAccess';

export const listMessages = async ({ data }: { data: z.infer<typeof listMessagesSchema> }) => {
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

    const messages = await Message.find(filter).sort({ seq: 1 }).limit(limit).lean();

    return (
      messages as Array<{
        _id: unknown;
        id: string;
        seq: number;
        sessionId: unknown;
        campaignId: unknown;
        channel: string;
        type: string;
        authorId: string;
        authorName: string;
        text: string;
        beyond20Data?: {
          title: string;
          source: string;
          description: string;
          properties: Record<string, string>;
        };
        timestamp: number;
      }>
    ).map((m) => ({
      id: m.id,
      seq: m.seq,
      sessionId: String(m.sessionId),
      campaignId: String(m.campaignId),
      channel: m.channel as 'general' | 'gm',
      type: m.type as 'chat' | 'spell-card' | 'trait' | 'item',
      authorId: m.authorId,
      authorName: m.authorName,
      text: m.text,
      beyond20Data: m.beyond20Data,
      timestamp: m.timestamp,
    }));
  } catch (e) {
    serverCaptureException(e, undefined, {
      action: 'listMessages',
      sessionId: data.sessionId,
    });
    throw e;
  }
};

export const saveMessage = async ({ data }: { data: z.infer<typeof saveMessageSchema> }) => {
  try {
    const user = await getSession();
    if (!user) throw new Error('Not authenticated');

    await connectDB();
    if (!isDBConnected()) throw new Error('Database not available');
    const { campaignId, isGM } = await requireSessionAccess(data.sessionId, user.id);
    if (data.campaignId !== campaignId) throw new Error('Session does not belong to campaign');
    if (data.channel === 'gm' && !isGM) throw new Error('Forbidden: GM channel requires GM role');

    // Enforce server-side author identity — override client-provided authorId
    const saveData = { ...data, authorId: user.id };

    await Message.updateOne(
      { id: data.id, sessionId: data.sessionId },
      {
        $set: saveData,
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );

    return { success: true };
  } catch (e) {
    serverCaptureException(e, undefined, {
      action: 'saveMessage',
      messageId: data.id,
      sessionId: data.sessionId,
    });
    throw e;
  }
};
