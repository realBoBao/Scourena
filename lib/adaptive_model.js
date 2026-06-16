/**
 * lib/adaptive_model.js — Adaptive model selection based on query type
 *
 * Tier 4: Tự động chọn model tối ưu theo loại câu hỏi
 * - Code queries → strong coding model
 * - Simple Q&A → fast/cheap model
 * - Complex reasoning → powerful model
 */

import { getLogger } from './logger.js';
const logger = getLogger('AdaptiveModel');

const MODEL_TIERS = {
  fast: process.env.MODEL_FAST || 'google/gemma-2-9b-it:free',
  standard: process.env.MODEL_STANDARD || 'openrouter/auto',
  powerful: process.env.MODEL_POWERFUL || 'anthropic/claude-sonnet-4',
};

export function selectModel(query, options = {}) {
  const q = query.toLowerCase();

  // Code-related → powerful model
  if (/code|algorithm|debug|implement|function|class|error|bug/.test(q)) {
    return MODEL_TIERS.powerful;
  }

  // Simple Q&A → fast model
  if (q.length < 50 && /^(what|who|when|where|how|is|are|do|does|can|could)/.test(q)) {
    return MODEL_TIERS.fast;
  }

  // Complex reasoning → powerful model
  if (/explain|analyze|compare|design|architecture|optimize|trade.?off/.test(q)) {
    return MODEL_TIERS.powerful;
  }

  // Default → standard
  return MODEL_TIERS.standard;
}

export function getModelStats() {
  return { tiers: MODEL_TIERS };
}
