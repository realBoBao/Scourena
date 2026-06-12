/**
 * ═══════════════════════════════════════════════════════════════
 * Temporal KG — API chính
 * ═══════════════════════════════════════════════════════════════
 *
 * Bi-temporal knowledge graph operations.
 * Dùng SQLite hiện có, không cần Neo4j.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'knowledge_graph.db');

function getDb() {
  return new Database(DB_PATH);
}

export class TemporalKG {

  static addFact(params) {
    const db = getDb();
    try {
      const {
        sourceEntity, targetEntity, relationship,
        validAt = new Date().toISOString(),
        source = 'unknown', confidence = 0.8, episodeId = null,
      } = params;

      // Upsert entities
      const sourceId = _upsertEntity(db, sourceEntity);
      const targetId = _upsertEntity(db, targetEntity);

      // Check existing active edge
      const existing = db.prepare(`
        SELECT id, confidence FROM edges
        WHERE source_id = ? AND target_id = ?
          AND relationship_type = ?
          AND invalid_at IS NULL
      `).get(sourceId, targetId, relationship);

      if (existing) {
        const newConf = Math.min(1.0, existing.confidence + 0.1);
        db.prepare(`UPDATE edges SET confidence = ?, ingested_at = datetime('now') WHERE id = ?`)
          .run(newConf, existing.id);
        return { action: 'reinforced', edgeId: existing.id };
      }

      const result = db.prepare(`
        INSERT INTO edges (source_id, target_id, relationship_type, weight,
          valid_at, ingested_at, confidence, source, episode_id)
        VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, ?)
      `).run(sourceId, targetId, relationship, confidence, validAt, confidence, source, episodeId);

      return { action: 'created', edgeId: result.lastInsertRowid };
    } finally {
      db.close();
    }
  }

  static invalidateFact(sourceEntity, targetEntity, relationship) {
    const db = getDb();
    try {
      const updated = db.prepare(`
        UPDATE edges SET invalid_at = datetime('now')
        WHERE source_id IN (SELECT id FROM entities WHERE lower(name) = lower(?))
          AND target_id IN (SELECT id FROM entities WHERE lower(name) = lower(?))
          AND relationship_type = ?
          AND invalid_at IS NULL
      `).run(sourceEntity, targetEntity, relationship);
      return updated.changes;
    } finally {
      db.close();
    }
  }

  static searchAtTime(topic, pointInTime = null) {
    const db = getDb();
    const ref = pointInTime ?? new Date().toISOString();
    try {
      return db.prepare(`
        SELECT
          e1.name AS source, e2.name AS target,
          ed.relationship_type, ed.valid_at, ed.invalid_at,
          ed.confidence, ed.source,
          CASE WHEN ed.invalid_at IS NULL THEN 'current' ELSE 'historical' END AS status
        FROM edges ed
        JOIN entities e1 ON e1.id = ed.source_id
        JOIN entities e2 ON e2.id = ed.target_id
        WHERE (lower(e1.name) LIKE lower(?) OR lower(e2.name) LIKE lower(?))
          AND ed.valid_at <= ?
          AND (ed.invalid_at IS NULL OR ed.invalid_at > ?)
        ORDER BY ed.confidence DESC, ed.valid_at DESC
        LIMIT 30
      `).all(`%${topic}%`, `%${topic}%`, ref, ref);
    } finally {
      db.close();
    }
  }

  static getRecentFacts(topic, days = 30) {
    const db = getDb();
    const from = new Date(Date.now() - days * 86400000).toISOString();
    try {
      return db.prepare(`
        SELECT
          e1.name AS source, e2.name AS target,
          ed.relationship_type, ed.valid_at, ed.confidence,
          ed.source AS data_source
        FROM edges ed
        JOIN entities e1 ON e1.id = ed.source_id
        JOIN entities e2 ON e2.id = ed.target_id
        WHERE (lower(e1.name) LIKE lower(?) OR lower(e2.name) LIKE lower(?))
          AND ed.ingested_at >= ?
          AND ed.invalid_at IS NULL
        ORDER BY ed.ingested_at DESC
        LIMIT 20
      `).all(`%${topic}%`, `%${topic}%`, from);
    } finally {
      db.close();
    }
  }

  static decayOldFacts(halfLifeDays = 90) {
    const db = getDb();
    const now = Date.now();
    try {
      const oldFacts = db.prepare(`
        SELECT id, confidence, ingested_at
        FROM edges
        WHERE invalid_at IS NULL
          AND ingested_at IS NOT NULL
      `).all();

      let decayed = 0;
      const stmt = db.prepare(`UPDATE edges SET confidence = ? WHERE id = ?`);

      for (const fact of oldFacts) {
        const ageDays = (now - new Date(fact.ingested_at).getTime()) / 86400000;
        const decayFactor = Math.pow(0.5, ageDays / halfLifeDays);
        const newConf = fact.confidence * decayFactor;

        if (newConf < 0.01) {
          db.prepare(`UPDATE edges SET invalid_at = datetime('now') WHERE id = ?`).run(fact.id);
          decayed++;
        } else {
          stmt.run(parseFloat(newConf.toFixed(4)), fact.id);
        }
      }

      return { processed: oldFacts.length, invalidated: decayed };
    } finally {
      db.close();
    }
  }

  static detectContradictions(newFact) {
    const db = getDb();
    const { sourceEntity, targetEntity, relationship } = newFact;
    try {
      return db.prepare(`
        SELECT e1.name AS source, e2.name AS target,
          ed.relationship_type, ed.valid_at, ed.confidence
        FROM edges ed
        JOIN entities e1 ON e1.id = ed.source_id
        JOIN entities e2 ON e2.id = ed.target_id
        WHERE (lower(e1.name) LIKE lower(?) OR lower(e2.name) LIKE lower(?))
          AND ed.relationship_type != ?
          AND ed.invalid_at IS NULL
          AND ed.confidence > 0.5
      `).all(`%${sourceEntity}%`, `%${targetEntity}%`, relationship);
    } finally {
      db.close();
    }
  }

  static createEpisode(source, topic, content = '') {
    const db = getDb();
    const id = randomUUID();
    try {
      db.prepare(`INSERT INTO kg_episodes (id, source, topic, content) VALUES (?, ?, ?, ?)`)
        .run(id, source, topic, content.slice(0, 500));
      return id;
    } finally {
      db.close();
    }
  }

  static updateEpisodeStats(episodeId, entityCount, edgeCount) {
    const db = getDb();
    try {
      db.prepare(`UPDATE kg_episodes SET entity_count = ?, edge_count = ? WHERE id = ?`)
        .run(entityCount, edgeCount, episodeId);
    } finally {
      db.close();
    }
  }
}

function _upsertEntity(db, name) {
  const existing = db.prepare(`SELECT id FROM entities WHERE lower(name) = lower(?)`).get(name);
  if (existing) return existing.id;
  const result = db.prepare(
    `INSERT INTO entities (name, type, created_at) VALUES (?, 'concept', datetime('now'))`
  ).run(name);
  return result.lastInsertRowid;
}
