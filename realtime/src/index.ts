import { MongoClient } from 'mongodb';
import { verifyBroadcastToken } from './auth.js';
import { MemoryHistoryStore, MongoHistoryStore, type HistoryStore } from './history.js';
import { createSessionHandler } from './parties/session.js';
import { tabletopHandler } from './parties/tabletop.js';
import { createTabletopMapHandler } from './parties/tabletopMap.js';
import { createRealtimeServer } from './server.js';
import { log } from './logger.js';

const PORT = Number(process.env.PORT ?? 1999);
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.trim() === '') {
  log.error('SESSION_SECRET is required');
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
  log.info('chat history persisted to MongoDB');
} else {
  store = new MemoryHistoryStore();
  log.warn('MONGODB_URI not set — chat history is in-memory only');
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

server.listen(PORT, () => log.info({ port: PORT }, 'listening'));

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    log.info({ signal }, 'shutting down');
    server.close(() => {
      void (mongo ? mongo.close() : Promise.resolve()).finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

process.on('uncaughtException', (err) => {
  log.error({ err }, 'uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  log.error({ err: reason }, 'unhandledRejection');
});
