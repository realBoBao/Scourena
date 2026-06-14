/**
 * ═══════════════════════════════════════════════════════════════
 * PostgreSQL Adapter — Cloud SQL compatible
 * ═══════════════════════════════════════════════════════════════
 *
 * Khi nào migrate sang PostgreSQL:
 * - Khi Cloud Run cần shared state giữa instances
 * - Khi data size > 1GB (SQLite file limit)
 * - Khi cần concurrent writes từ nhiều instances
 *
 * Cloud SQL free tier: shared e2-micro + 30GB storage
 *
 * Cài đặt:
 *   npm install pg
 *   Đặt DATABASE_URL=postgresql://user:pass@host:5432/db trong .env
 *
 * Migration:
 *   node -e "import('./lib/db_postgres.js').then(m => m.migrateFromSqlite())"
 *
 * @module lib/db_postgres
 */

import { getLogger } from './logger.js';

const logger = getLogger('Postgres');

let _pool = null;

async function getPool() {
  if (_pool) return _pool;

  try {
    const { default: pg } = await import('pg');
    _pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5, // Cloud Run: keep pool small
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    _pool.on('error', (err) => {
      logger.errorObj('Pool error', err);
    });

    logger.info('[Postgres] Pool created');
    return _pool;
  } catch (err) {
    logger.errorObj('Failed to create pool', err);
    throw err;
  }
}

/** Initialize schema */
export async function initSchema() {
  const pool = await getPool();

  await pool.query(`
    -- Flashcards table
    CREATE TABLE IF NOT EXISTS flashcards (
      id SERIAL PRIMARY KEY,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      source TEXT,
      category TEXT DEFAULT 'general',
      difficulty INTEGER DEFAULT 1,
      next_review TIMESTAMPTZ,
      review_count INTEGER DEFAULT 0,
      correct_count INTEGER DEFAULT 0,
      fsrs_state JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_flashcards_next_review ON flashcards(next_review);
    CREATE INDEX IF NOT EXISTS idx_flashcards_category ON flashcards(category);

    -- Knowledge graph: entities
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'concept',
      description TEXT DEFAULT '',
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Knowledge graph: edges
    CREATE TABLE IF NOT EXISTS edges (
      id SERIAL PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES entities(id),
      target_id TEXT NOT NULL REFERENCES entities(id),
      relation TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
    CREATE INDEX IF NOT EXISTS idx_edges_relation ON edges(relation);

    -- Entity aliases
    CREATE TABLE IF NOT EXISTS entity_aliases (
      alias TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL REFERENCES entities(id)
    );

    -- Vectors (using pgvector extension)
    -- CREATE EXTENSION IF NOT EXISTS vector;
    -- CREATE TABLE IF NOT EXISTS vectors (
    --   id TEXT PRIMARY KEY,
    --   doc_id TEXT,
    --   chunk_index INTEGER,
    --   chunk_text TEXT,
    --   embedding vector(768),
    --   url TEXT,
    --   project TEXT,
    --   category TEXT,
    --   metadata JSONB DEFAULT '{}',
    --   added_at TIMESTAMPTZ DEFAULT NOW(),
    --   updated_at TIMESTAMPTZ DEFAULT NOW()
    -- );
    -- CREATE INDEX ON vectors USING ivfflat (embedding vector_cosine_ops);

    -- Sessions (for PlannerAgent)
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      original_request JSONB,
      dag JSONB DEFAULT '[]',
      current_step INTEGER,
      status TEXT DEFAULT 'planning',
      results JSONB DEFAULT '{}',
      history JSONB DEFAULT '[]',
      final_result JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);
  `);

  logger.info('[Postgres] Schema initialized');
}

/** Close pool (for graceful shutdown) */
export async function closePool() {
  if (_pool) {
    await _pool.end();
    _pool = null;
    logger.info('[Postgres] Pool closed');
  }
}

/** Get pool for direct queries */
export { getPool };

/** Migrate flashcards from SQLite */
export async function migrateFlashcardsFromSqlite() {
  const pool = await getPool();

  try {
    const sqlite3 = (await import('sqlite3')).default;
    const { open } = await import('sqlite');
    const db = await open({ filename: './flashcards.db', driver: sqlite3.default.Database });

    const rows = await db.all('SELECT * FROM flashcards');
    logger.info(`[Postgres] Migrating ${rows.length} flashcards...`);

    let migrated = 0;
    for (const row of rows) {
      await pool.query(`
        INSERT INTO flashcards (id, question, answer, source, category, difficulty, next_review, review_count, correct_count, fsrs_state, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (id) DO NOTHING
      `, [
        row.id, row.question, row.answer, row.source, row.category,
        row.difficulty, row.next_review, row.review_count, row.correct_count,
        row.fsrs_state, row.created_at, row.updated_at,
      ]);
      migrated++;
    }

    await db.close();
    logger.info(`[Postgres] Migrated ${migrated} flashcards`);
    return { success: true, migrated };
  } catch (err) {
    logger.errorObj('Migration error', err);
    return { success: false, error: err.message };
  }
}
