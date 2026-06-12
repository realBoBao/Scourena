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

const logger = getLogger('SemanticCache');

export class SemanticCache {
  constructor(options = {}) {
    this.threshold = options.threshold ?? 0.92; // Cosine similarity threshold
    this.maxEntries = options.maxEntries ?? 500;
    this.cacheFile = options.cacheFile ?? './.semantic_cache.json';
    this.entries = []; // [{ embedding: Float32Array, answer: string, query: string, ts: string }]
    this._loaded = false;
    this._dirty = false;
    this._saveInterval = null;
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
   * Returns { answer, query, similarity } or null.
   */
  async get(queryEmbedding) {
    await this.initialize();

    if (!this.entries.length) return null;

    let bestMatch = null;
    let bestSim = 0;

    for (const entry of this.entries) {
      if (!entry.embedding) continue;
      const sim = cosineSimilarity(queryEmbedding, entry.embedding);
      if (sim > bestSim) {
        bestSim = sim;
        bestMatch = { answer: entry.answer, query: entry.query, similarity: sim };
      }
    }

    if (bestMatch && bestMatch.similarity >= this.threshold) {
      logger.debug(`[SemanticCache] HIT (sim: ${bestMatch.similarity.toFixed(3)}): "${bestMatch.query.slice(0, 50)}..."`);
      return bestMatch;
    }

    return null;
  }

  /**
   * Store a query-answer pair in the cache.
   */
  async set(queryEmbedding, answer, query = '') {
    await this.initialize();

    this.entries.push({
      embedding: queryEmbedding,
      answer,
      query: query.slice(0, 200),
      ts: new Date().toISOString(),
    });

    // Evict oldest if over max
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    this._dirty = true;
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

  getStats() {
    return {
      entries: this.entries.length,
      threshold: this.threshold,
      maxEntries: this.maxEntries,
    };
  }
}

export default SemanticCache;
