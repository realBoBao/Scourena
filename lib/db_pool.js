/**
 * ═══════════════════════════════════════════════════════════════
 * DB Pool — SQLite connection management for Cloud Run
 * ═══════════════════════════════════════════════════════════════
 *
 * Quản lý SQLite connections với:
 * - WAL mode (crash safety)
 * - Singleton pattern (1 connection per DB file)
 * - Graceful close
 * - Statement caching (prepared statements)
 *
 * Tại sao không dùng better-sqlite3?
 * - `better-sqlite3` là synchronous, không tương thích với async/await pattern
 *   hiện tại trong codebase (flashcard_db.js, knowledge_graph.js, vector_store.js).
 * - Migrate toàn bộ sang synchronous sẽ break nhiều code.
 * - Giải pháp này: giữ `sqlite` (async) wrapper nhưng thêm WAL mode,
 *   statement caching, và connection reuse.
 *
 * Khi nào migrate sang better-sqlite3?
 * - Khi muốn tối ưu performance cao hơn (sync I/O nhanh hơn async cho SQLite).
 * - Khi sẵn sàng refactor toàn bộ DB access thành synchronous.
 *
 * @module lib/db_pool
 */

import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// ── Connection Registry ──────────────────────────────────────────────────────
const _connections = new Map(); // dbPath → { db, refCount, closeTimer }
const _preparedStatements = new Map(); // dbPath → { sql → statement }

/**
 * Get or create a SQLite connection with WAL mode.
 * Connections are reused (singleton per file).
 *
 * @param {string} dbPath - Absolute path to SQLite file
 * @param {Object} [options]
 * @param {boolean} [options.wal=true] - Enable WAL mode
 * @param {boolean} [options.foreignKeys=true] - Enable foreign keys
 */
export async function getConnection(dbPath, options = {}) {
  const { wal = true, foreignKeys = true } = options;

  if (_connections.has(dbPath)) {
    const conn = _connections.get(dbPath);
    conn.refCount++;
    // Cancel any pending close
    if (conn.closeTimer) {
      clearTimeout(conn.closeTimer);
      conn.closeTimer = null;
    }
    return conn.db;
  }

  const db = await open({ filename: dbPath, driver: sqlite3.Database });

  // Apply PRAGMAs
  if (wal) {
    await db.exec('PRAGMA journal_mode=WAL');
    await db.exec('PRAGMA synchronous=NORMAL');
  }
  if (foreignKeys) {
    await db.exec('PRAGMA foreign_keys=ON');
  }
  // Performance tuning
  await db.exec('PRAGMA cache_size=-64000'); // 64MB cache
  await db.exec('PRAGMA temp_store=MEMORY');
  await db.exec('PRAGMA mmap_size=268435456'); // 256MB mmap

  _connections.set(dbPath, { db, refCount: 1, closeTimer: null });
  _preparedStatements.set(dbPath, new Map());

  return db;
}

/**
 * Release a connection. If refCount reaches 0, schedule close.
 * @param {string} dbPath
 * @param {number} [delayMs=5000] - Delay before actual close (allows reuse)
 */
export function releaseConnection(dbPath, delayMs = 5000) {
  const conn = _connections.get(dbPath);
  if (!conn) return;

  conn.refCount = Math.max(0, conn.refCount - 1);

  if (conn.refCount === 0) {
    // Schedule close after delay (allows quick reuse)
    conn.closeTimer = setTimeout(async () => {
      const current = _connections.get(dbPath);
      if (current && current.refCount === 0) {
        try {
          await current.db.close();
        } catch (err) {
          console.error(`[DB Pool] Error closing ${dbPath}:`, err.message);
        }
        _connections.delete(dbPath);
        _preparedStatements.delete(dbPath);
      }
    }, delayMs);
  }
}

/**
 * Force close a connection immediately.
 */
export async function closeConnection(dbPath) {
  const conn = _connections.get(dbPath);
  if (!conn) return;

  if (conn.closeTimer) {
    clearTimeout(conn.closeTimer);
  }

  try {
    await conn.db.close();
  } catch (err) {
    console.error(`[DB Pool] Error closing ${dbPath}:`, err.message);
  }

  _connections.delete(dbPath);
  _preparedStatements.delete(dbPath);
}

/**
 * Close all connections (for graceful shutdown).
 */
export async function closeAllConnections() {
  const paths = [..._connections.keys()];
  for (const dbPath of paths) {
    await closeConnection(dbPath);
  }
}

/**
 * Get a prepared statement (cached per connection).
 * Prepared statements are faster for repeated queries.
 */
export async function prepare(dbPath, sql) {
  const stmts = _preparedStatements.get(dbPath);
  if (stmts && stmts.has(sql)) {
    return stmts.get(sql);
  }

  const conn = _connections.get(dbPath);
  if (!conn) throw new Error(`No connection for ${dbPath}`);

  const stmt = await conn.db.prepare(sql);
  if (stmts) stmts.set(sql, stmt);
  return stmt;
}

/**
 * Get pool statistics.
 */
export function getPoolStats() {
  const stats = {};
  for (const [path, conn] of _connections) {
    stats[path] = {
      refCount: conn.refCount,
      hasCloseTimer: !!conn.closeTimer,
      preparedStatements: _preparedStatements.get(path)?.size || 0,
    };
  }
  return stats;
}
