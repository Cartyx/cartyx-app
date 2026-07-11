import { useQuery } from '@tanstack/react-query';
import { useState, useMemo, useCallback, useRef } from 'react';
import { createServerFn } from '@tanstack/react-start';
import { queryKeys } from '~/utils/queryKeys';
import { withRetry } from '~/utils/retryMutation';
import { listMessagesSchema, saveMessageSchema } from '~/types/schemas/chat';
import type { ParsedSpellCard } from './useBeyond20';

const listMessagesFn = createServerFn({ method: 'GET' })
  .inputValidator(listMessagesSchema)
  .handler(async ({ data }) => {
    const { listMessages } = await import('~/server/functions/chat');
    return listMessages({ data });
  });

const saveMessageFn = createServerFn({ method: 'POST' })
  .inputValidator(saveMessageSchema)
  .handler(async ({ data }) => {
    const { saveMessage } = await import('~/server/functions/chat');
    return saveMessage({ data });
  });

export interface ChatMessage {
  id: string;
  seq: number;
  sessionId: string;
  campaignId: string;
  channel: 'general' | 'gm';
  type: 'chat' | 'spell-card' | 'trait' | 'item';
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
}

function mergeMessages(fromMongo: ChatMessage[], fromParty: ChatMessage[]): ChatMessage[] {
  const seen = new Map<string, ChatMessage>();
  for (const m of fromMongo) seen.set(m.id, m);
  for (const m of fromParty) {
    if (!seen.has(m.id)) seen.set(m.id, m);
  }
  return [...seen.values()].sort((a, b) => a.timestamp - b.timestamp || a.seq - b.seq);
}

export function useChatMessages(sessionId: string, campaignId: string, isActiveSession: boolean) {
  const { data: mongoMessages } = useQuery({
    queryKey: queryKeys.chat.list(sessionId),
    queryFn: () => listMessagesFn({ data: { sessionId } }),
    enabled: !!sessionId,
  });

  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const pendingSaves = useRef(new Set<string>());

  const handlePartyMessage = useCallback((msg: unknown) => {
    const parsed = msg as Record<string, unknown>;
    const msgType = parsed.type as string;
    if (msgType === 'HISTORY') {
      const allMessages = (parsed.messages ?? []) as Array<Record<string, unknown>>;
      const chatMessages = allMessages
        .filter((m) => m.type === 'CHAT' || m.type === 'SPELL_CARD')
        .map((m) => ({
          ...(m as unknown as ChatMessage),
          type: (m.type === 'CHAT' ? 'chat' : 'spell-card') as ChatMessage['type'],
        }));
      console.debug(`[Realtime] HISTORY received chatCount=${chatMessages.length}`);
      setLiveMessages(chatMessages);
    } else if (msgType === 'CHAT' || msgType === 'SPELL_CARD') {
      const chatMsg = parsed as unknown as ChatMessage;
      const normalizedType = msgType === 'CHAT' ? 'chat' : 'spell-card';
      const normalized = { ...chatMsg, type: normalizedType as ChatMessage['type'] };
      setLiveMessages((prev) => [...prev, normalized]);

      // Persist if this is a message we sent (pending save)
      if (pendingSaves.current.has(normalized.id)) {
        pendingSaves.current.delete(normalized.id);
        void withRetry(
          () => saveMessageFn({ data: normalized }),
          {
            sessionId: normalized.sessionId,
            campaignId: normalized.campaignId,
            messageType: msgType as 'CHAT' | 'SPELL_CARD',
            messageId: normalized.id,
          },
          () => setSaveError("Some messages couldn't be saved to session history.")
        );
      }
    }
  }, []);

  const sendMessage = useCallback(
    (
      text: string,
      channel: 'general' | 'gm',
      userId: string,
      userName: string,
      socket: { send: (data: string) => void } | null
    ) => {
      if (!socket) return;

      const message: ChatMessage = {
        id: crypto.randomUUID(),
        seq: 0,
        sessionId,
        campaignId,
        channel,
        type: 'chat',
        authorId: userId,
        authorName: userName,
        text,
        timestamp: Date.now(),
      };

      const wsMessage = { ...message, type: 'CHAT' as const };
      pendingSaves.current.add(message.id);
      socket.send(JSON.stringify(wsMessage));
      console.debug(`[Realtime] Message sent type=CHAT id=${message.id}`);
    },
    [sessionId, campaignId]
  );

  const sendSpellCard = useCallback(
    (
      card: ParsedSpellCard,
      userId: string,
      userName: string,
      socket: { send: (data: string) => void } | null
    ) => {
      if (!socket) return;

      const message: ChatMessage = {
        id: crypto.randomUUID(),
        seq: 0,
        sessionId,
        campaignId,
        channel: card.channel,
        type: 'spell-card',
        authorId: userId,
        authorName: card.character || userName,
        text: '',
        beyond20Data: {
          title: card.title,
          source: card.source,
          description: card.description,
          properties: card.properties,
        },
        timestamp: Date.now(),
      };

      const wsMessage = {
        ...message,
        type: 'SPELL_CARD' as const,
        character: card.character,
        title: card.title,
        source: card.source,
        description: card.description,
        properties: card.properties,
      };
      pendingSaves.current.add(message.id);
      socket.send(JSON.stringify(wsMessage));
      console.debug(`[Realtime] Message sent type=SPELL_CARD id=${message.id}`);
    },
    [sessionId, campaignId]
  );

  const messages = useMemo(() => {
    const mongo = (mongoMessages ?? []) as ChatMessage[];
    if (!isActiveSession) return mongo;

    const count = mergeMessages(mongo, liveMessages);
    console.debug(
      `[Merge] Dedup stats mongoCount=${mongo.length} partyCount=${liveMessages.length} finalCount=${count.length}`
    );
    return count;
  }, [mongoMessages, liveMessages, isActiveSession]);

  return {
    messages,
    sendMessage,
    sendSpellCard,
    handlePartyMessage,
    saveError,
    setSaveError,
  };
}
