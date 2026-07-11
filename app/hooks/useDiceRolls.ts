import { useQuery } from '@tanstack/react-query';
import { useState, useMemo, useCallback, useRef } from 'react';
import { createServerFn } from '@tanstack/react-start';
import { queryKeys } from '~/utils/queryKeys';
import { withRetry } from '~/utils/retryMutation';
import { listDiceRollsSchema, saveDiceRollSchema } from '~/types/schemas/diceRolls';
import type { ParsedDiceRoll } from './useBeyond20';

const listDiceRollsFn = createServerFn({ method: 'GET' })
  .inputValidator(listDiceRollsSchema)
  .handler(async ({ data }) => {
    const { listDiceRolls } = await import('~/server/functions/diceRolls');
    return listDiceRolls({ data });
  });

const saveDiceRollFn = createServerFn({ method: 'POST' })
  .inputValidator(saveDiceRollSchema)
  .handler(async ({ data }) => {
    const { saveDiceRoll } = await import('~/server/functions/diceRolls');
    return saveDiceRoll({ data });
  });

export interface DiceRollMessage {
  id: string;
  seq: number;
  sessionId: string;
  campaignId: string;
  channel: 'general' | 'gm';
  character: string;
  title: string;
  rollType: string;
  attackRolls: Array<{
    roll: number;
    type: 'hit' | 'crit' | 'miss' | 'crit-fail';
    total: number;
    formula: string;
    discarded: boolean;
    dice: number[];
  }>;
  damageRolls: Array<{
    damageType: string;
    dice: number[];
    total: number;
    flags: number;
    formula: string;
  }>;
  totalDamages: Record<string, number>;
  rollInfo: Array<[string, string]>;
  description: string;
  timestamp: number;
}

function mergeRolls(fromMongo: DiceRollMessage[], fromParty: DiceRollMessage[]): DiceRollMessage[] {
  const seen = new Map<string, DiceRollMessage>();
  for (const m of fromMongo) seen.set(m.id, m);
  for (const m of fromParty) {
    if (!seen.has(m.id)) seen.set(m.id, m);
  }
  return [...seen.values()].sort((a, b) => a.timestamp - b.timestamp || a.seq - b.seq);
}

export function useDiceRolls(sessionId: string, campaignId: string, isActiveSession: boolean) {
  const { data: mongoRolls } = useQuery({
    queryKey: queryKeys.diceRolls.list(sessionId),
    queryFn: () => listDiceRollsFn({ data: { sessionId } }),
    enabled: !!sessionId,
  });

  const [liveRolls, setLiveRolls] = useState<DiceRollMessage[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const pendingSaves = useRef(new Set<string>());

  const handlePartyMessage = useCallback((msg: unknown) => {
    const parsed = msg as Record<string, unknown>;
    const msgType = parsed.type as string;
    if (msgType === 'HISTORY') {
      const allMessages = (parsed.messages ?? []) as Array<Record<string, unknown>>;
      const diceMessages = allMessages.filter(
        (m) => m.type === 'DICE'
      ) as unknown as DiceRollMessage[];
      console.debug(`[Realtime] HISTORY received diceCount=${diceMessages.length}`);
      setLiveRolls(diceMessages);
    } else if (msgType === 'DICE') {
      const diceMsg = parsed as unknown as DiceRollMessage;
      setLiveRolls((prev) => [...prev, diceMsg]);

      // Persist if this is a roll we sent (pending save)
      if (pendingSaves.current.has(diceMsg.id)) {
        pendingSaves.current.delete(diceMsg.id);
        void withRetry(
          () => saveDiceRollFn({ data: diceMsg }),
          {
            sessionId: diceMsg.sessionId,
            campaignId: diceMsg.campaignId,
            messageType: 'DICE',
            messageId: diceMsg.id,
          },
          () => setSaveError("Some dice rolls couldn't be saved to session history.")
        );
      }
    }
  }, []);

  const sendDiceRoll = useCallback(
    (roll: ParsedDiceRoll, socket: { send: (data: string) => void } | null) => {
      if (!socket) return;

      const message: DiceRollMessage = {
        id: crypto.randomUUID(),
        seq: 0,
        sessionId,
        campaignId,
        channel: roll.channel,
        character: roll.character,
        title: roll.title,
        rollType: roll.rollType,
        attackRolls: roll.attackRolls,
        damageRolls: roll.damageRolls,
        totalDamages: roll.totalDamages,
        rollInfo: roll.rollInfo,
        description: roll.description,
        timestamp: Date.now(),
      };

      const wsMessage = { ...message, type: 'DICE' as const };
      pendingSaves.current.add(message.id);
      socket.send(JSON.stringify(wsMessage));
      console.debug(`[Realtime] Message sent type=DICE id=${message.id}`);
    },
    [sessionId, campaignId]
  );

  const rolls = useMemo(() => {
    const mongo = (mongoRolls ?? []) as DiceRollMessage[];
    if (!isActiveSession) return mongo;

    const merged = mergeRolls(mongo, liveRolls);
    console.debug(
      `[Merge] Dedup stats mongoCount=${mongo.length} partyCount=${liveRolls.length} finalCount=${merged.length}`
    );
    return merged;
  }, [mongoRolls, liveRolls, isActiveSession]);

  return {
    rolls,
    sendDiceRoll,
    handlePartyMessage,
    saveError,
    setSaveError,
  };
}
