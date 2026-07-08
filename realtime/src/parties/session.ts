import type { HistoryStore } from '../history.js';
import type { Room } from '../rooms.js';
import type { PartyHandler } from './types.js';

const HISTORY_LIMIT = 50;
const VALID_TYPES = new Set(['CHAT', 'DICE', 'SPELL_CARD']);

type RoomMessage = {
  type: string;
  id: string;
  seq?: number;
  sessionId?: string;
  channel?: 'general' | 'gm';
  authorId?: string;
  text?: unknown;
  attackRolls?: unknown;
  title?: unknown;
  [key: string]: unknown;
};

type SessionState = { history: RoomMessage[]; seq: number; loading: Promise<void> | null };

function getState(room: Room): SessionState {
  if (!room.state) {
    room.state = { history: [], seq: 0, loading: null } satisfies SessionState;
  }
  return room.state as SessionState;
}

async function ensureLoaded(room: Room, store: HistoryStore): Promise<SessionState> {
  const state = getState(room);
  if (!state.loading) {
    state.loading = store.load(room.id).then((entries) => {
      state.history = entries.map((e) => e.msg as RoomMessage);
      state.seq = entries.length > 0 ? entries[entries.length - 1].seq : 0;
    });
  }
  await state.loading;
  return state;
}

export function createSessionHandler(store: HistoryStore): PartyHandler {
  return {
    async onConnect(peer, room) {
      const state = await ensureLoaded(room, store);
      const visible =
        peer.role === 'gm' ? state.history : state.history.filter((m) => m.channel !== 'gm');
      peer.ws.send(JSON.stringify({ type: 'HISTORY', messages: visible }));
    },

    async onMessage(raw, sender, room) {
      const state = await ensureLoaded(room, store);

      let msg: RoomMessage;
      try {
        msg = JSON.parse(raw) as RoomMessage;
      } catch {
        return;
      }
      if (!msg.type || !msg.id) return;
      if (!VALID_TYPES.has(msg.type)) return;
      if ('sessionId' in msg && msg.sessionId !== room.id) return;
      if (msg.type === 'CHAT' && typeof msg.text !== 'string') return;
      if (msg.type === 'DICE' && !Array.isArray(msg.attackRolls)) return;
      if (msg.type === 'SPELL_CARD' && typeof msg.title !== 'string') return;
      if (msg.channel === 'gm' && sender.role !== 'gm') return;
      if ('authorId' in msg) msg.authorId = sender.userId;

      state.seq++;
      msg.seq = state.seq;
      state.history = [...state.history, msg];

      if (state.history.length > HISTORY_LIMIT) {
        state.history.splice(0, state.history.length - HISTORY_LIMIT);
        await store.deleteUpTo(room.id, state.seq - HISTORY_LIMIT);
      }
      await store.append({ roomId: room.id, seq: state.seq, msg });

      const payload = JSON.stringify(msg);
      if (msg.channel === 'gm') {
        for (const p of room.peers) {
          if (p.role === 'gm' && p.ws.readyState === p.ws.OPEN) p.ws.send(payload);
        }
      } else {
        room.broadcast(payload);
      }
    },
  };
}
