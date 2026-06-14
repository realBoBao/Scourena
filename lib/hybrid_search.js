/**
 * ═══════════════════════════════════════════════════════════════
 * Hybrid Search — BM25 + Vector với Reciprocal Rank Fusion
 * ═══════════════════════════════════════════════════════════════
 *
 * Kết hợp 2 phương pháp search:
 *   - BM25: tốt cho exact keyword match (tên thuật toán, tên hàm, code)
 *   - HNSW Vector: tốt cho semantic similarity (ý nghĩa, ngữ cảnh)
 *
 * Fusion: Reciprocal Rank Fusion (RRF)
 *   score(d) = Σ 1 / (k + rank_i(d))   với k = 60
 *   Paper: https://plg.uwaterloo.ca/~gvcormac/cormacksigir2009-rrf.pdf
 *
 * Tại sao RRF thay vì weighted sum?
 *   - Không cần normalize scores giữa BM25 và Cosine
 *   - Robust với outliers
 *   - Đơn giản, không cần tune weights
 *
 * Usage:
 *   import { hybridSearch } from './hybrid_search.js';
 *   const results = await hybridSearch('binary search algorithm', {
 *     limit: 5,
 *     bm25Weight: 0.5,  // 0.5 = equal, 0.7 = BM25 preferred
 *   });
 *
 * @module lib/hybrid_search
 */

import { searchBm25 } from './bm25_search.js';
import { search as vectorSearch } from './vector_store.js';
import { embedText } from './embeddings.js';

// ── RRF constant (Cormack et al. 2009) ──
const RRF_K = 60;

/**
 * Reciprocal Rank Fusion
 * @param {Array[]} rankedLists — Mảng các kết quả từ nhiều source
 *   Mỗi item cần có: { id, score?, ... }
 * @param {number} k — RRF constant (default 60)
 * @returns {Array} Merged & sorted results
 */
export function reciprocalRankFusion(rankedLists, k = RRF_K) {
  const scores = new Map(); // id → accumulated RRF score
  const items = new Map();  // id → original item

  for (const list of rankedLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank];
      const id = item.id;
      if (!id) continue;

      const rrfScore = 1 / (k + rank + 1); // rank is 0-indexed, formula uses 1-indexed
      scores.set(id, (scores.get(id) || 0) + rrfScore);

      // Keep the item with highest individual score
      if (!items.has(id) || (item.score || 0) > (items.get(id).score || 0)) {
        items.set(id, item);
      }
    }
  }

  // Sort by accumulated RRF score descending
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, rrfScore]) => ({
      ...items.get(id),
      rrfScore: Math.round(rrfScore * 10000) / 10000,
    }));
}

/**
 * Weighted Reciprocal Rank Fusion
 * Cho phép weight khác nhau cho từng source.
 *
 * @param {Array[]} rankedLists
 * @param {number[]} weights — Weight cho mỗi list (e.g., [0.5, 0.5])
 * @param {number} k
 */
export function weightedRRF(rankedLists, weights, k = RRF_K) {
  const scores = new Map();
  const items = new Map();

  for (let listIdx = 0; listIdx < rankedLists.length; listIdx++) {
    const list = rankedLists[listIdx];
    const weight = weights[listIdx] || 1 / rankedLists.length;

    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank];
      const id = item.id;
      if (!id) continue;

      const rrfScore = weight / (k + rank + 1);
      scores.set(id, (scores.get(id) || 0) + rrfScore);

      if (!items.has(id) || (item.score || 0) > (items.get(id).score || 0)) {
        items.set(id, item);
      }
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, rrfScore]) => ({
      ...items.get(id),
      rrfScore: Math.round(rrfScore * 10000) / 10000,
    }));
}

/**
 * Hybrid Search — BM25 + Vector với RRF fusion
 *
 * @param {string} query — Search query
 * @param {Object} options
 * @param {number} [options.limit=5] — Số kết quả trả về
 * @param {number} [options.bm25Weight=0.5] — Weight cho BM25 (0-1), vector = 1 - bm25Weight
 * @param {number} [options.bm25Limit=10] — Số kết quả BM25 lấy ra trước khi fusion
 * @param {number} [options.vectorLimit=10] — Số kết quả vector lấy ra trước khi fusion
 * @param {string} [options.category] — Filter theo category
 * @returns {Array} Merged results với rrfScore
 */
export async function hybridSearch(query, options = {}) {
  const {
    limit = 5,
    bm25Weight = 0.5,
    bm25Limit = 10,
    vectorLimit = 10,
    category = null,
  } = options;

  // Run BM25 and Vector search in parallel
  const [bm25Results, vectorResults] = await Promise.allSettled([
    searchBm25(query, bm25Limit, category),
    (async () => {
      const embedding = await embedText(query);
      return vectorSearch(embedding, vectorLimit, category);
    })(),
  ]);

  const bm25Items = bm25Results.status === 'fulfilled' ? bm25Results.value : [];
  const vectorItems = vectorResults.status === 'fulfilled' ? vectorResults.value : [];

  // Normalize results to common format
  const bm25Ranked = bm25Items.map((item, i) => ({
    id: item.id || item.doc_id || `bm25_${i}`,
    text: item.chunk_text || item.text || '',
    score: item.score || item.bm25Score || 0,
    source: 'bm25',
    ...item,
  }));

  const vectorRanked = vectorItems.map((item, i) => ({
    id: item.id || item.doc_id || `vec_${i}`,
    text: item.chunk_text || item.text || '',
    score: item.score || item.similarity || 0,
    source: 'vector',
    ...item,
  }));

  // If only one source available, return it directly
  if (bm25Ranked.length === 0) return vectorRanked.slice(0, limit);
  if (vectorRanked.length === 0) return bm25Ranked.slice(0, limit);

  // Weighted RRF fusion
  const vectorWeight = 1 - bm25Weight;
  const fused = weightedRRF(
    [bm25Ranked, vectorRanked],
    [bm25Weight, vectorWeight]
  );

  return fused.slice(0, limit);
}

/**
 * Hybrid Search với auto-weight dựa trên query type
 *
 * Heuristic:
 * - Query có code keywords (function, class, def, import) → BM25 weight cao hơn
 * - Query dài > 10 từ → Vector weight cao hơn (semantic)
 * - Query ngắn 1-3 từ → BM25 weight cao hơn (keyword)
 */
export async function autoHybridSearch(query, options = {}) {
  const codeKeywords = /\b(function|class|def|import|const|var|let|return|if|else|for|while|async|await|try|catch|throw|new|this|super|extends|implements|interface|type|enum|struct|fn|pub|mod|use|crate)\b/i;
  const words = query.trim().split(/\s+/);

  let bm25Weight = 0.5;

  if (codeKeywords.test(query)) {
    bm25Weight = 0.7; // Code queries → BM25 preferred
  } else if (words.length <= 3) {
    bm25Weight = 0.6; // Short queries → BM25 preferred
  } else if (words.length > 10) {
    bm25Weight = 0.3; // Long queries → Vector preferred
  }

  return hybridSearch(query, { ...options, bm25Weight });
}
