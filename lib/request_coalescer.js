/**
 * lib/request_coalescer.js — Dedup concurrent identical requests
 *
 * Tier 3: Nếu nhiều request giống nhau đến cùng lúc, chỉ gọi API 1 lần
 * Các request còn lại chờ kết quả từ request đầu tiên
 */

import { getLogger } from './logger.js';
const logger = getLogger('RequestCoalescer');

const _pending = new Map();

export async function coalesce(key, fn, ttlMs = 5000) {
  if (_pending.has(key)) {
    logger.debug(`[Coalesce] Reusing pending request: ${key.slice(0, 50)}`);
    return _pending.get(key);
  }

  const promise = fn().finally(() => {
    setTimeout(() => _pending.delete(key), ttlMs);
  });

  _pending.set(key, promise);
  return promise;
}

export function getStats() {
  return { pending: _pending.size };
}
