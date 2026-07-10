import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { MemoryHistoryStore, MongoHistoryStore, type HistoryStore } from './history.js';

function behavesLikeHistoryStore(name: string, getStore: () => HistoryStore) {
  describe(name, () => {
    it('loads appended messages in seq order, isolated per room', async () => {
      const store = getStore();
      await store.append({ roomId: 'a', seq: 2, msg: { id: 'm2' } });
      await store.append({ roomId: 'a', seq: 1, msg: { id: 'm1' } });
      await store.append({ roomId: 'b', seq: 1, msg: { id: 'other' } });
      const loaded = await store.load('a');
      expect(loaded.map((e) => e.seq)).toEqual([1, 2]);
      expect(loaded.map((e) => (e.msg as { id: string }).id)).toEqual(['m1', 'm2']);
    });

    it('deleteUpTo removes only messages with seq <= bound', async () => {
      const store = getStore();
      for (let seq = 1; seq <= 5; seq++) {
        await store.append({ roomId: 'trim', seq, msg: { id: `m${seq}` } });
      }
      await store.deleteUpTo('trim', 3);
      expect((await store.load('trim')).map((e) => e.seq)).toEqual([4, 5]);
    });

    it('load of an unknown room returns []', async () => {
      expect(await getStore().load('nope')).toEqual([]);
    });
  });
}

behavesLikeHistoryStore('MemoryHistoryStore', () => new MemoryHistoryStore());

describe('MongoHistoryStore', () => {
  let mongod: MongoMemoryServer;
  let client: MongoClient;
  let store: MongoHistoryStore;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    client = new MongoClient(mongod.getUri());
    await client.connect();
    store = new MongoHistoryStore(client.db('test'));
    await store.ensureIndexes();
  });
  afterAll(async () => {
    await client.close();
    await mongod.stop();
  });

  behavesLikeHistoryStore('shared behavior', () => store);
});
