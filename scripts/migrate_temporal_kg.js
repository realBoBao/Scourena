/**
 * Migration: Thêm temporal columns vào knowledge_graph.db
 * Chạy 1 lần: node scripts/migrate_temporal_kg.js
 */
import path from 'path';
import { migrateTemporalSchema } from '../lib/knowledge_graph_temporal.js';

const DB_PATH = path.join(process.cwd(), 'data', 'knowledge_graph.db');
console.log(`[migrate] Target: ${DB_PATH}`);
migrateTemporalSchema(DB_PATH);
console.log('[migrate] Done!');
