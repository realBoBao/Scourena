/**
 * lib/sqlite_adapter.js — SQLite adapter with dual backend
 * Tries node:sqlite first (Node 22.5+), falls back to better-sqlite3 (Node 20+).
 *
 * Jest ESM fix: Uses conditional exports pattern to avoid
 * "Identifier 'getDb' has already been declared" errors.
 */

let _initialized = false;
let DatabaseSync = null;
let DatabaseBetter = null;
let _db = null;

async function _ensureInit() {
  if (_initialized) return;
  _initialized = true;
  try {
    DatabaseSync = (await import('node:sqlite')).DatabaseSync;
  } catch { /* node:sqlite not available */ }
  try {
    DatabaseBetter = (await import('better-sqlite3')).default;
  } catch { /* better-sqlite3 not installed */ }
}

async function _getDb() {
  await _ensureInit();
  if (_db) return _db;
  const dbPath = process.env.DB_PATH || './data.db';
  if (DatabaseSync) {
    _db = new DatabaseSync(dbPath);
    if (!_db.run) {
      _db.run  = (sql, ...p) => _db.prepare(sql).run(...p.flat());
      _db.get  = (sql, ...p) => _db.prepare(sql).get(...p.flat());
      _db.all  = (sql, ...p) => _db.prepare(sql).all(...p.flat());
      _db.exec = (sql)       => { _db.prepare(sql).run(); return _db; };
    }
  } else if (DatabaseBetter) {
    _db = new DatabaseBetter(dbPath);
  } else {
    throw new Error('No SQLite backend available');
  }
  return _db;
}

function _runDb(db, sql, ...params) {
  if (db.prepare) return db.prepare(sql).run(...params);
  return db.run(sql, params);
}

function _getDbRow(db, sql, ...params) {
  if (db.prepare) return db.prepare(sql).get(...params);
  return db.get(sql, params);
}

function _getAllDbRows(db, sql, ...params) {
  if (db.prepare) return db.prepare(sql).all(...params);
  return db.all(sql, params);
}

function _closeDb() {
  if (_db) {
    try { _db.close(); } catch { /* ignore */ }
    _db = null;
  }
}

async function _openDbFile(dbPath) {
  await _ensureInit();
  if (DatabaseSync) return new DatabaseSync(dbPath);
  if (DatabaseBetter) return new DatabaseBetter(dbPath);
  throw new Error('No SQLite backend available');
}

async function _openDb() { return _getDb(); }
async function _initDb() { await _ensureInit(); }

// ── Exports: use var to allow re-declaration in Jest ESM ──
export const getDb = _getDb;
export const runDb = _runDb;
export const getDbRow = _getDbRow;
export const getAllDbRows = _getAllDbRows;
export const openDb = _openDb;
export const closeDb = _closeDb;
export const openDbFile = _openDbFile;
export const initDb = _initDb;
export const open = _getDb;
