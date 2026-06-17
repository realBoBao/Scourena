import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

let _db = null;

export async function getDb() {
  if (_db) return _db;
  const dbPath = process.env.DB_PATH || './data.db';
  _db = await open({
    filename: dbPath,
    driver: sqlite3.default?.Database || sqlite3.Database,
  });
  return _db;
}

export function openDb() { return getDb(); }
export function closeDb() { /* no-op */ }
export { getDb as open };
