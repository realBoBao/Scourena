/**
 * Structured Logger — Zero-Cost Telemetry Sink (Tier 1)
 *
 * Xuất mọi log dưới dạng JSON lines (mỗi dòng = 1 JSON object).
 * Google Cloud Logging tự động parse structured JSON từ stdout/stderr.
 * Log Sink → BigQuery không cần thêm code nào ở phía Node.js.
 *
 * Format mỗi dòng:
 *   {"ts":"2025-01-15T...","lvl":"info","cmp":"RagAgent","msg":"query answered","data":{"query":"...","latency_ms":120}}
 *
 * Usage:
 *   import { info, warn, error, debug } from './lib/structured_logger.js';
 *   info('RagAgent', 'query answered', { query, latency_ms: 120 });
 *   error('Gateway', 'service crashed', { service: 'discord', code: 1 });
 *
 * ponytail: Không dùng pino/winston để tránh dependency.
 *   Nếu cần pretty-print local dev, pipe qua `node -e "process.stdin.on('data',d=>console.log(JSON.parse(d)))"`.
 */

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function shouldLog(level) {
  return (LEVELS[level] ?? 1) >= (LEVELS[LOG_LEVEL] ?? 1);
}

/**
 * Core log function — writes one JSON line to the appropriate stream.
 */
function log(level, component, message, data) {
  if (!shouldLog(level)) return;

  const entry = {
    ts: new Date().toISOString(),
    lvl: level,
    cmp: component,
    msg: message,
    ...(data !== undefined && data !== null ? { data } : {}),
  };

  const line = JSON.stringify(entry) + '\n';

  if (level === 'error') {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

/** Info level — normal operations */
export function info(component, message, data) {
  log('info', component, message, data);
}

/** Warn level — recoverable issues */
export function warn(component, message, data) {
  log('warn', component, message, data);
}

/** Error level — failures requiring attention */
export function error(component, message, data) {
  log('error', component, message, data);
}

/** Debug level — verbose diagnostics (filtered out in production by default) */
export function debug(component, message, data) {
  log('debug', component, message, data);
}

/**
 * Create a component-scoped logger.
 * Returns { info, warn, error, debug } bound to the component name.
 *
 * Usage:
 *   const log = scoped('RagAgent');
 *   log.info('query answered', { latency_ms: 120 });
 */
export function scoped(component) {
  return {
    info: (msg, data) => info(component, msg, data),
    warn: (msg, data) => warn(component, msg, data),
    error: (msg, data) => error(component, msg, data),
    debug: (msg, data) => debug(component, msg, data),
  };
}
