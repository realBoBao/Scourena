/**
 * Last30Days Research — Search recent developments via Tavily
 *
 * Replaces the Alexa skill package with direct Tavily web search.
 * Searches for latest developments about a topic in the last 30 days.
 *
 * @module lib/last30days
 */

import { getLogger } from './logger.js';
const logger = getLogger('Last30Days');

const TAVILY_URL = 'https://api.tavily.com/search';

/**
 * Research a topic from the last 30 days using Tavily search.
 * @param {string} topic - Topic to research
 * @returns {{ summary: string, sources: string[], prompts: string[] }}
 */
export async function researchTopic(topic) {
  logger.info(`[Last30Days] Researching: ${topic}`);

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    logger.warn('[Last30Days] No TAVILY_API_KEY, skipping');
    return { summary: '', sources: [], prompts: [] };
  }

  try {
    const res = await fetch(TAVILY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: `latest developments about ${topic} in the last 30 days`,
        search_depth: 'advanced',
        max_results: 8,
        include_answer: true,
        days: 30,
      }),
    });

    if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);

    const data = await res.json();
    const sources = (data.results || []).map(r => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.content?.slice(0, 300) || '',
    }));

    return {
      summary: data.answer || sources.map(s => s.snippet).join('\n\n'),
      sources: sources.map(s => s.url),
      prompts: generatePrompts(topic, sources),
    };
  } catch (err) {
    logger.warn('[Last30Days] Search failed:', err.message);
    return { summary: '', sources: [], prompts: [] };
  }
}

/**
 * Generate copy-paste-ready prompts from research results.
 */
function generatePrompts(topic, sources) {
  if (!sources.length) return [];
  return [
    `Tóm tát 3 điểm chính về ${topic} từ các nguồn gần đây.`,
    `So sánh ${topic} trước và sau những thay đổi gần đây.`,
    `Liệt kê 5 câu hỏi phỏng vấn về ${topic} dựa trên trends hiện tại.`,
  ];
}
