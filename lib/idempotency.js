/**
 * lib/idempotency.js — API Idempotency (Tier 1)
 * Chặn duplicate requests do retry tự động (Cloud Run, Discord Webhook).
 * Dùng content hash làm Idempotency-Key.
 * @module lib/idempotency
 */

import crypto from 'crypto';
import { getLogger } from './logger.js';
const logger = getLogger('Idempotency');

// Map<hash, { status: 'processing'|'done', result, timestamp }>
const _cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 giờ — cùng query trong ngày chỉ chạy 1 lần
const MAX_ENTRIES = 1000;

/**
 * Tạo idempotency key từ content.
 * @param {string} content
 * @returns {string} — SHA-256 hash
 */
export function createKey(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Kiểm tra request đã được xử lý chưa.
 * @param {string} key
 * @returns {{ cached: boolean, result?: any }}
 */
export function check(key) {
  const entry = _cache.get(key);
  if (!entry) return { cached: false };

  // Check TTL
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    _cache.delete(key);
    return { cached: false };
  }

  if (entry.status === 'processing') {
    logger.info(`[Idempotency] Request ${key} đang xử lý — skip duplicate`);
    return { cached: true, result: null, processing: true };
  }

  if (entry.status === 'done') {
    logger.info(`[Idempotency] Request ${key} đã xử lý — return cached result`);
    return { cached: true, result: entry.result, duplicate: true };
  }

  return { cached: false };
}

/**
 * Đánh dấu request đang xử lý.
 * @param {string} key
 */
export function markProcessing(key) {
  _cache.set(key, { status: 'processing', result: null, timestamp: Date.now() });
  _evictIfNeeded();
}

/**
 * Đánh dấu request đã xử lý xong.
 * @param {string} key
 * @param {any} result
 */
export function markDone(key, result) {
  _cache.set(key, { status: 'done', result, timestamp: Date.now() });
}

/**
 * Xóa entry.
 * @param {string} key
 */
export function invalidate(key) {
  _cache.delete(key);
}

/**
 * Xóa tất cả entries.
 */
export function clear() {
  _cache.clear();
}

/**
 * Lấy số lượng entries.
 */
export function size() {
  return _cache.size;
}

/**
 * Evict entries cũ nếu vượt quá MAX_ENTRIES.
 */
function _evictIfNeeded() {
  if (_cache.size <= MAX_ENTRIES) return;

  // Xóa 20% entries cũ nhất
  const entries = [..._cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
  const toDelete = Math.floor(MAX_ENTRIES * 0.2);
  for (let i = 0; i < toDelete; i++) {
    _cache.delete(entries[i][0]);
  }
  logger.debug(`[Idempotency] Evicted ${toDelete} old entries`);
}
