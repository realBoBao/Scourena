/**
 * Semantic Cache — Avoid redundant API calls for semantically similar queries
 *
 * Uses embedding cosine similarity to detect duplicate/similar queries.
 * If a similar query was answered before, return cached answer without calling LLM.
 *
 * Usage:
 *   import { SemanticCache } from './semantic_cache.js';
 *   const cache = new SemanticCache({ threshold: 0.92, maxEntries: 500 });
 *   const cached = await cache.get(queryEmbedding);
 *   if (cached) return cached.answer;
 *   // ... call LLM ...
 *   await cache.set(queryEmbedding, answer);
 *
 * @module lib/semantic_cache
 */

import { writeJsonAtomic, readJsonSafe } from './atomic_write.js';
import { cosineSimilarity } from './embeddings.js';
import { getLogger } from './logger.js';
import { coalesce } from './promise_coalescer.js';

const logger = getLogger('SemanticCache');

export class SemanticCache {
  constructor(options = {}) {
    this.threshold = options.threshold ?? 0.92; // Cosine similarity threshold
    this.maxEntries = options.maxEntries ?? 500;
    this.cacheFile = options.cacheFile ?? './.semantic_cache.json';
    this.ttlHours = options.ttlHours ?? 168; // Default 7 days (168h)
    this.sourceTiers = options.sourceTiers || { academic: 1.0, system: 0.8, daily: 0.7, web: 0.5 };
    this.entries = []; // [{ embedding: Float32Array, answer: string, query: string, ts: string }]
    this._loaded = false;
    this._dirty = false;
    this._saveInterval = null;

    // ── LRU: access order tracking ──
    // Map<entryIndex, lastAccessTime> — oldest entries evicted first
    this._accessOrder = new Map();
    this._accessCounter = 0;

    // ── Tier 1: Exact match cache (hash → answer, O(1) lookup) ──
    this._exactCache = new Map(); // queryHash → { answer, embedding, query, ts }
  }

  async initialize() {
    if (this._loaded) return;
    try {
      const data = await readJsonSafe(this.cacheFile, []);
      this.entries = data.map(e => ({
        ...e,
        embedding: e.embedding ? new Float32Array(e.embedding) : null,
      })).filter(e => e.embedding && e.answer);
      logger.info(`[SemanticCache] Loaded ${this.entries.length} entries`);
    } catch (err) {
      logger.warn('[SemanticCache] Load failed, starting fresh:', err.message);
      this.entries = [];
    }
    this._loaded = true;
    // Auto-save every 60s if dirty
    this._saveInterval = setInterval(() => this._flush(), 60000);
  }

  /**
   * Look up a cached answer for a query embedding.
   * 2-tier: exact hash match (O(1)) → semantic similarity scan (O(N)).
   * Returns { answer, query, similarity, tier } or null.
   */
  async get(queryEmbedding, queryText = '', options = {}, contextHash = '') {
    await this.initialize();

    // ── Tier 0: Promise Coalescing — nếu đang có request tương tự đang chạy, chờ kết quả ──
    const cacheKey = queryText.slice(0, 100);
    if (cacheKey) {
      try {
        return await coalesce(`semantic:${cacheKey}`, () => this._doGet(queryEmbedding, queryText), 5000);
      } catch {
        // Fallback to direct get nếu coalesce fail
      }
    }

    return this._doGet(queryEmbedding, queryText, options, contextHash);
  }

  async _doGet(queryEmbedding, queryText = '', options = {}, contextHash = '') {
    // ── Tier 1: Exact hash match (O(1)) ──
    if (queryText) {
      const hash = this._hashQuery(queryText);
      const exact = this._exactCache.get(hash);
      if (exact) {
        this._touchExact(hash);
        logger.debug(`[SemanticCache] HIT tier-1 (exact): "${queryText.slice(0, 50)}..."`);
        return { answer: exact.answer, query: exact.query, similarity: 1.0, tier: 'exact' };
      }
    }

    if (!this.entries.length) return null;

    // ── Tier 2: Semantic similarity scan ──
    let bestMatch = null;
    let bestSim = 0;
    let bestIdx = -1;

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      if (!entry.embedding) continue;
      const sim = cosineSimilarity(queryEmbedding, entry.embedding);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
        bestMatch = { answer: entry.answer, query: entry.query, similarity: sim, tier: 'semantic' };
      }
    }

    if (bestMatch && bestMatch.similarity >= this.threshold) {
      // Tier 2: Boost score by source quality
      const qualityBoost = this.sourceTiers[bestMatch.source] || 0.5;
      bestMatch.effectiveScore = bestMatch.similarity * (0.7 + 0.3 * qualityBoost);
      this._touch(bestIdx);
      logger.debug(`[SemanticCache] HIT tier-2 (sim: ${bestMatch.similarity.toFixed(3)}): "${bestMatch.query.slice(0, 50)}..."`);
      return bestMatch;
    }

    return null;
  }

  /** Simple hash for exact match tier */
  _hashQuery(text) {
    // Normalize: lowercase, trim, collapse whitespace
    const normalized = text.toLowerCase().trim().replace(/\s+/g, ' ');
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return String(hash);
  }

  /** Mark entry as recently accessed (LRU) */
  _touch(index) {
    this._accessOrder.set(index, ++this._accessCounter);
  }

  /** Mark exact cache entry as recently accessed */
  _touchExact(hash) {
    this._accessOrder.set(`exact:${hash}`, ++this._accessCounter);
  }

  /**
   * Store a query-answer pair in the cache.
   * Uses LRU eviction: removes least recently accessed entries when full.
   */
  async set(queryEmbedding, answer, query = '', contextHash = '') {
    await this.initialize();

    // Tier 1: Store in exact cache
    if (query) {
      const hash = this._hashQuery(query);
      this._exactCache.set(hash, {
        embedding: queryEmbedding,
        answer,
        query: query.slice(0, 200),
        ts: new Date().toISOString(),
      });
      this._touchExact(hash);

      // Evict oldest exact cache entries if over limit
      if (this._exactCache.size > this.maxEntries) {
        this._evictOldestExact();
      }
    }

    // Tier 2: Store in semantic cache
    const newIdx = this.entries.length;
    this.entries.push({
      embedding: queryEmbedding,
      answer,
      query: query.slice(0, 200),
      ts: new Date().toISOString(),
    });
    this._touch(newIdx);

    // LRU eviction: remove least recently accessed
    if (this.entries.length > this.maxEntries) {
      this._evictOldest();
    }

    this._dirty = true;
  }

  /** Rebuild access order indices after splice */
  _rebuildAccessOrder() {
    const newOrder = new Map();
    let idx = 0;
    for (const [key, time] of this._accessOrder) {
      if (typeof key === 'string' && key.startsWith('exact:')) {
        newOrder.set(key, time);
      } else if (typeof key === 'number') {
        if (key < this.entries.length) newOrder.set(idx++, time);
      }
    }
    this._accessOrder = newOrder;
  }

  /** Evict least recently accessed semantic cache entries */
  _evictOldest() {
    // Find the entry with oldest access time
    let oldestIdx = 0;
    let oldestTime = Infinity;

    for (const [key, time] of this._accessOrder) {
      if (typeof key === 'number' && time < oldestTime) {
        oldestTime = time;
        oldestIdx = key;
      }
    }

    // Remove the oldest entry
    this.entries.splice(oldestIdx, 1);
    this._accessOrder.delete(oldestIdx);

    // Rebuild access order indices (since we spliced)
    const newOrder = new Map();
    for (const [key, time] of this._accessOrder) {
      if (typeof key === 'number' && key > oldestIdx) {
        newOrder.set(key - 1, time);
      } else {
        newOrder.set(key, time);
      }
    }
    this._accessOrder = newOrder;
  }

  /** Evict oldest exact cache entries */
  _evictOldestExact() {
    let oldestHash = null;
    let oldestTime = Infinity;

    for (const [key, time] of this._accessOrder) {
      if (typeof key === 'string' && key.startsWith('exact:') && time < oldestTime) {
        oldestTime = time;
        oldestHash = key.slice(6); // Remove 'exact:' prefix
      }
    }

    if (oldestHash) {
      this._exactCache.delete(oldestHash);
      this._accessOrder.delete(`exact:${oldestHash}`);
    }
  }

  /**
   * Flush cache to disk (atomic write).
   */
  async _flush() {
    if (!this._dirty) return;
    try {
      // Serialize embeddings as plain arrays for JSON
      const data = this.entries.map(e => ({
        ...e,
        embedding: e.embedding ? Array.from(e.embedding) : null,
      }));
      await writeJsonAtomic(this.cacheFile, data);
      this._dirty = false;
      logger.debug(`[SemanticCache] Saved ${this.entries.length} entries`);
    } catch (err) {
      logger.warn('[SemanticCache] Save failed:', err.message);
    }
  }

  /**
   * Force save and stop auto-save interval.
   */
  async destroy() {
    if (this._saveInterval) clearInterval(this._saveInterval);
    await this._flush();
  }

  /** Tier 4: Invalidate cache entries by context hash (event-driven) */
  invalidateByContext(contextHash) {
    let removed = 0;
    // Remove from exact cache
    for (const [key, entry] of this._exactCache) {
      if (entry.contextHash === contextHash) {
        this._exactCache.delete(key);
        removed++;
      }
    }
    // Remove from semantic cache
    this.entries = this.entries.filter(e => {
      if (e.contextHash === contextHash) { removed++; return false; }
      return true;
    });
    if (removed > 0) {
      this._rebuildAccessOrder();
      this._dirty = true;
      logger.info(`[SemanticCache] Invalidated ${removed} entries for context: ${contextHash}`);
    }
    return removed;
  }

  /** Tier 4: Invalidate all cache (full reset) */
  invalidateAll() {
    const count = this.entries.length + this._exactCache.size;
    this.entries = [];
    this._exactCache.clear();
    this._accessOrder.clear();
    this._dirty = true;
    logger.info(`[SemanticCache] Full invalidation: ${count} entries cleared`);
    return count;
  }

  /** Cleanup all expired entries (called periodically) */
  cleanupExpired() {
    const now = new Date();
    let removed = 0;
    this.entries = this.entries.filter(e => {
      if (e.expires_at && new Date(e.expires_at) < now) {
        removed++;
        return false;
      }
      return true;
    });
    if (removed > 0) {
      this._rebuildAccessOrder();
      this._dirty = true;
      logger.info(`[SemanticCache] Cleaned up ${removed} expired entries`);
    }
    return removed;
  }

  getStats() {
    return {
      entries: this.entries.length,
      threshold: this.threshold,
      maxEntries: this.maxEntries,
    };
  }
}

export default SemanticCache;
