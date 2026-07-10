import type { Collection, Db } from 'mongodb';

export type StoredMessage = { roomId: string; seq: number; msg: unknown };

export interface HistoryStore {
  /** All messages for a room, ordered by seq ascending. */
  load(roomId: string): Promise<StoredMessage[]>;
  append(entry: StoredMessage): Promise<void>;
  /** Delete every message in the room with seq <= maxSeqInclusive. */
  deleteUpTo(roomId: string, maxSeqInclusive: number): Promise<void>;
}

export class MemoryHistoryStore implements HistoryStore {
  private rooms = new Map<string, StoredMessage[]>();

  async load(roomId: string): Promise<StoredMessage[]> {
    return [...(this.rooms.get(roomId) ?? [])].sort((a, b) => a.seq - b.seq);
  }
  async append(entry: StoredMessage): Promise<void> {
    const list = this.rooms.get(entry.roomId) ?? [];
    list.push(entry);
    this.rooms.set(entry.roomId, list);
  }
  async deleteUpTo(roomId: string, maxSeqInclusive: number): Promise<void> {
    const kept = (this.rooms.get(roomId) ?? []).filter((m) => m.seq > maxSeqInclusive);
    this.rooms.set(roomId, kept);
  }
}

export class MongoHistoryStore implements HistoryStore {
  private col: Collection<StoredMessage>;

  constructor(db: Db) {
    this.col = db.collection<StoredMessage>('realtime_room_messages');
  }
  async ensureIndexes(): Promise<void> {
    await this.col.createIndex({ roomId: 1, seq: 1 }, { unique: true });
  }
  async load(roomId: string): Promise<StoredMessage[]> {
    return this.col
      .find({ roomId }, { projection: { _id: 0 } })
      .sort({ seq: 1 })
      .toArray();
  }
  async append(entry: StoredMessage): Promise<void> {
    await this.col.insertOne({ ...entry });
  }
  async deleteUpTo(roomId: string, maxSeqInclusive: number): Promise<void> {
    await this.col.deleteMany({ roomId, seq: { $lte: maxSeqInclusive } });
  }
}
