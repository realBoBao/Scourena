/**
 * lib/knowledge_gap_ingest.js — Auto-ingest documents for knowledge gaps
 *
 * Tier 4: Khi phát hiện topic thiếu kiến thức, tự động tìm và ingest tài liệu
 */

import { getLogger } from './logger.js';
import { searchEntities, upsertEntity, addRelationship } from './knowledge_graph.js';
import { upsertDocument } from './vector_store.js';
import { embedText } from './embeddings.js';

const logger = getLogger('KnowledgeGapIngest');

/**
 * Detect knowledge gaps by checking which topics have low flashcard coverage
 */
export async function detectGaps(db, minCards = 3) {
  const rows = await db.all(`
    SELECT category, COUNT(*) as card_count
    FROM flashcards
    GROUP BY category
    HAVING card_count < ?
    ORDER BY card_count ASC
  `, minCards);

  return rows.map(r => ({ topic: r.category, cards: r.card_count }));
}

/**
 * Auto-ingest documents for a knowledge gap topic
 */
export async function ingestForGap(topic, options = {}) {
  const maxDocs = options.maxDocs || 5;
  logger.info(`[GapIngest] Ingesting for topic: ${topic}`);

  // Search for related entities in KG
  const entities = await searchEntities(topic, null, maxDocs);

  let ingested = 0;
  for (const entity of entities) {
    try {
      // Create or update entity
      const entityId = await upsertEntity(entity.name, entity.type, entity.description);

      // Embed and store
      const text = `${entity.name}: ${entity.description || ''}`;
      const embedding = await embedText(text);
      await upsertDocument(`gap:${entityId}`, { source: 'gap-ingest', topic }, [text], [embedding]);

      ingested++;
    } catch (err) {
      logger.warn(`[GapIngest] Failed for ${entity.name}:`, err.message);
    }
  }

  logger.info(`[GapIngest] Done: ${ingested} docs for "${topic}"`);
  return { topic, ingested };
}

/**
 * Run full gap detection + ingest cycle
 */
export async function runGapCycle(db) {
  const gaps = await detectGaps(db);
  const results = [];

  for (const gap of gaps.slice(0, 3)) { // Max 3 topics per cycle
    const result = await ingestForGap(gap.topic);
    results.push(result);
  }

  return { gaps: gaps.length, results };
}
