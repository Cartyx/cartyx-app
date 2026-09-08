// Read-only Atlas inventory. Never imports application models or runs bootstrap.
import mongoose from 'mongoose';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = process.argv[2];
if (!['local-env', 'dev', 'prod'].includes(source))
  throw new Error('Label the source: local-env|dev|prod');
if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
const client = new mongoose.mongo.MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000,
  socketTimeoutMS: 30000,
});
try {
  await client.connect();
  const db = client.db();
  const collections = [];
  for (const entry of await db.listCollections({}, { nameOnly: true }).toArray()) {
    if (entry.name.startsWith('system.')) continue;
    const collection = db.collection(entry.name);
    const [count, indexes] = await Promise.all([
      collection.countDocuments({}, { maxTimeMS: 20000 }),
      collection.listIndexes().toArray(),
    ]);
    collections.push({
      name: entry.name,
      count,
      indexes: indexes.map(
        ({ name, key, unique, sparse, partialFilterExpression, expireAfterSeconds }) => ({
          name,
          key,
          unique,
          sparse,
          partialFilterExpression,
          expireAfterSeconds,
        })
      ),
    });
  }
  const stats = await db.stats();
  const report = {
    capturedAt: new Date().toISOString(),
    source,
    collections: collections.sort((a, b) => a.name.localeCompare(b.name)),
    dataSize: stats.dataSize,
    storageSize: stats.storageSize,
    indexSize: stats.indexSize,
  };
  const directory = resolve('.local/data/inventory');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(`${directory}/${source}.json`, JSON.stringify(report, null, 2) + '\n', {
    mode: 0o600,
  });
  console.log(
    `Read-only inventory: ${collections.length} collections, ${collections.reduce((n, c) => n + c.count, 0)} documents, ${stats.dataSize} logical bytes. Private report: .local/data/inventory/${source}.json`
  );
} finally {
  await client.close();
}
