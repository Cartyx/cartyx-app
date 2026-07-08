import { MongoClient } from 'mongodb';
import { verifyBroadcastToken } from './auth.js';
import { MemoryHistoryStore, MongoHistoryStore, type HistoryStore } from './history.js';
import { createSessionHandler } from './parties/session.js';
import { tabletopHandler } from './parties/tabletop.js';
import { createTabletopMapHandler } from './parties/tabletopMap.js';
import { createRealtimeServer } from './server.js';

const PORT = Number(process.env.PORT ?? 1999);
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.trim() === '') {
  console.error('[realtime] SESSION_SECRET is required');
  process.exit(1);
}

let store: HistoryStore;
let mongo: MongoClient | null = null;
if (process.env.MONGODB_URI) {
  mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();
  const mongoStore = new MongoHistoryStore(mongo.db());
  await mongoStore.ensureIndexes();
  store = mongoStore;
  console.info('[realtime] chat history persisted to MongoDB');
} else {
  store = new MemoryHistoryStore();
  console.warn('[realtime] MONGODB_URI not set — chat history is in-memory only');
}

const server = createRealtimeServer({
  sessionSecret: SESSION_SECRET,
  handlers: {
    main: createSessionHandler(store),
    tabletop: tabletopHandler,
    tabletop_map: createTabletopMapHandler({
      verifyBroadcastToken: (h) => verifyBroadcastToken(h, SESSION_SECRET),
    }),
  },
});

server.listen(PORT, () => console.info(`[realtime] listening on :${PORT}`));

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.info(`[realtime] ${signal} — shutting down`);
    server.close(() => {
      void (mongo ? mongo.close() : Promise.resolve()).finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

process.on('uncaughtException', (err) => {
  console.error('[realtime] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[realtime] unhandledRejection:', reason);
});
