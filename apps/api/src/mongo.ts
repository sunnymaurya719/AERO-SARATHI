import { MongoClient, type Db } from 'mongodb';
import { env } from './env.js';
import { logger } from './logger.js';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectMongo(): Promise<Db> {
  if (db) return db;
  client = new MongoClient(env.MONGO_URL);
  await client.connect();
  db = client.db();
  logger.info('mongo connected');
  return db;
}

export function getMongo(): Db | null {
  return db;
}

export async function closeMongo(): Promise<void> {
  await client?.close();
  client = null;
  db = null;
}
