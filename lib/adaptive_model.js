/**
 * lib/adaptive_model.js — Adaptive model selection based on query type
 *
 * Tier 2: Tự động chọn model + provider tối ưu theo loại câu hỏi
 * - Code/reasoning → Groq (llama-3.3-70b — strong, fast, cheap)
 * - Simple Q&A → Gemini Flash (fast, low cost)
 * - Complex/long context → OpenRouter (auto-routing)
 *
 * Returns: { model, provider, tier }
 */

const MODEL_TIERS = {
  fast: {
    model: process.env.MODEL_FAST || 'gemini-2.0-flash',
    provider: 'gemini',
    reason: 'simple-qa',
  },
  standard: {
    model: process.env.MODEL_STANDARD || 'openrouter/auto',
    provider: 'openrouter',
    reason: 'general',
  },
  powerful: {
    model: process.env.MODEL_POWERFUL || 'llama-3.3-70b-versatile',
    provider: 'groq',
    reason: 'code-reasoning',
  },
};

export function selectModel(query, options = {}) {
  const q = query.toLowerCase();

  // Code-related → Groq powerful model
  if (/code|algorithm|debug|implement|function|class|error|bug|refactor|test/.test(q)) {
    return MODEL_TIERS.powerful;
  }

  // Simple short Q&A → Gemini fast
  if (q.length < 80 && /^(what|who|when|where|how|is|are|do|does|can|could|why|which)\b/.test(q)) {
    return MODEL_TIERS.fast;
  }

  // Complex reasoning → Groq powerful model
  if (/explain|analyze|compare|design|architecture|optimize|trade.?off|review|evaluate/.test(q)) {
    return MODEL_TIERS.powerful;
  }

  // Long context (>200 chars) → OpenRouter auto
  if (q.length > 200) {
    return MODEL_TIERS.standard;
  }

  // Default → Gemini fast (cheapest for simple queries)
  return MODEL_TIERS.fast;
}

export function getModelStats() {
  return { tiers: MODEL_TIERS };
}
