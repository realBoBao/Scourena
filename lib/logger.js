import crypto from 'crypto';

function envBool(name, defaultVal = false) {
  const v = process.env[name];
  if (v === undefined) return defaultVal;
  return String(v).toLowerCase() === 'true' || v === '1' || v === 'yes';
}

const ENABLE_DEBUG = envBool('LOG_DEBUG', false);
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();

// ── Log level filter ─────────────────────────────────────────────────────────
const LEVEL_ORDER = { debug: 0, info: 1, warn: 2, error: 3 };
function shouldLog(level) {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[LOG_LEVEL];
}

// ── Request ID tracking (for Cloud Run trace correlation) ───────────────────
const _requestIds = new Map(); // asyncLocalStorage alternative for Node ESM

export function setRequestId(id) {
  const key = typeof require !== 'undefined' ? require('worker_threads').threadId : 0;
  _requestIds.set(key, id);
}

export function getRequestId() {
  const key = typeof require !== 'undefined' ? require('worker_threads').threadId : 0;
  return _requestIds.get(key) || null;
}

export function clearRequestId() {
  const key = typeof require !== 'undefined' ? require('worker_threads').threadId : 0;
  _requestIds.delete(key);
}

/**
 * Structured JSON logger — Cloud Run optimized.
 * Outputs single-line JSON for each log entry.
 * Supports: levels, request IDs, child loggers, timing.
 */
export function getLogger(context = '') {
  const prefix = context ? `[${context}]` : '[app]';

  function base(level, msg, meta) {
    if (!shouldLog(level)) return;

    const line = {
      ts: new Date().toISOString(),
      level,
      prefix,
      reqId: getRequestId() || undefined,
      msg,
      ...(meta && typeof meta === 'object' ? meta : {}),
    };

    // Remove undefined fields
    Object.keys(line).forEach(k => line[k] === undefined && delete line[k]);

    try {
      console.log(JSON.stringify(line));
    } catch (_) {
      console.log(`${level} ${prefix} ${msg}`);
    }
  }

  const logger = {
    info: (msg, meta) => base('info', msg, meta),
    warn: (msg, meta) => base('warn', msg, meta),
    error: (msg, meta) => base('error', msg, meta),
    debug: (msg, meta) => base('debug', msg, meta),

    /** Create child logger with sub-context */
    child(subContext) {
      return getLogger(`${context}:${subContext}`);
    },

    /** Time an operation */
    async time(label, fn, meta = {}) {
      const start = Date.now();
      try {
        const result = await fn();
        base('info', `${label} completed`, { ...meta, duration: Date.now() - start });
        return result;
      } catch (err) {
        base('error', `${label} failed`, { ...meta, duration: Date.now() - start, error: err.message });
        throw err;
      }
    },

    /** Log with error object */
    errorObj(msg, err, meta = {}) {
      base('error', msg, {
        ...meta,
        error: err.message,
        stack: ENABLE_DEBUG ? err.stack : undefined,
        code: err.code || undefined,
      });
    },
  };

  return logger;
}

export default getLogger;
