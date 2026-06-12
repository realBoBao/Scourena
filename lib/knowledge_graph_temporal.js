/**
 * ═══════════════════════════════════════════════════════════════
 * Temporal Knowledge Graph — Bi-temporal model (Graphiti-style)
 * ═══════════════════════════════════════════════════════════════
 *
 * Thêm temporal layer vào knowledge_graph.js hiện có.
 * Không cần Neo4j hay Python — chạy trên SQLite.
 *
 * Bi-temporal model:
 * - valid_at: khi fact đúng trong thực tế
 * - invalid_at: khi fact không còn đúng (NULL = vẫn valid)
 * - ingested_at: khi hệ thống biết về fact
 *
 * Migration: node scripts/migrate_temporal_kg.js
 */

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'knowledge_graph.db');

/**
 * Migrate schema — thêm temporal columns vào edges table hiện có.
 * Chạy một lần, idempotent.
 */
export function migrateTemporalSchema(dbPath = DB_PATH) {
  const db = new Database(dbPath);

  const existingCols = db.prepare('PRAGMA table_info(edges)').all().map(c => c.name);

  const migrations = [
    { col: 'valid_at',    sql: `ALTER TABLE edges ADD COLUMN valid_at    TEXT DEFAULT (datetime('now'))` },
    { col: 'invalid_at',  sql: `ALTER TABLE edges ADD COLUMN invalid_at  TEXT` },
    { col: 'ingested_at', sql: `ALTER TABLE edges ADD COLUMN ingested_at TEXT DEFAULT (datetime('now'))` },
    { col: 'confidence',  sql: `ALTER TABLE edges ADD COLUMN confidence  REAL DEFAULT 0.8` },
    { col: 'source',      sql: `ALTER TABLE edges ADD COLUMN source      TEXT DEFAULT 'unknown'` },
    { col: 'episode_id',  sql: `ALTER TABLE edges ADD COLUMN episode_id  TEXT` },
  ];

  for (const { col, sql } of migrations) {
    if (!existingCols.includes(col)) {
      db.exec(sql);
      console.log(`[temporal_kg] Added column '${col}' to edges`);
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS kg_episodes (
      id           TEXT PRIMARY KEY,
      source       TEXT NOT NULL,
      content      TEXT,
      topic        TEXT,
      entity_count INTEGER DEFAULT 0,
      edge_count   INTEGER DEFAULT 0,
      created_at   TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_edges_valid_at    ON edges(valid_at);
    CREATE INDEX IF NOT EXISTS idx_edges_invalid_at  ON edges(invalid_at);
    CREATE INDEX IF NOT EXISTS idx_edges_episode     ON edges(episode_id);
    CREATE INDEX IF NOT EXISTS idx_edges_source      ON edges(source);
  `);

  console.log('[temporal_kg] Schema migration complete');
  db.close();
}
