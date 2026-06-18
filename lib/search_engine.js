/**
 * lib/search_engine.py — Unified Search Engine (Tier 1+2+3)
 *
 * Multi-layer search với circuit breaker:
 * 1. Tavily API (AI-Native Search) — primary
 * 2. DuckDuckGo — fallback khi Tavily hết quota
 * 3. Jina Reader — đọc sâu web content
 *
 * Usage:
 *   import { searchWeb, readWebPage } from './search_engine.js';
 *   const results = await searchWeb('microservices architecture');
 *   const content = await readWebPage('https://nodejs.org');
 */

import { getLogger } from './logger.js';
import { fetchWithRetry } from './fetch_retry.js';

const logger = getLogger('SearchEngine');

// ── Tavily API ───────────────────────────────────────────────────────────────
const TAVILY_API_URL = 'https://api.tavily.com/search';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';

/**
 * Search với Tavily API (AI-Native Search)
 * @param {string} query
 * @param {number} maxResults
 * @returns {Promise<Array<{title, url, content, score}>>}
 */
async function searchTavily(query, maxResults = 5) {
  if (!TAVILY_API_KEY) {
    throw new Error('TAVILY_API_KEY not set');
  }

  const res = await fetch(TAVILY_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: TAVILY_API_KEY,
      query,
      max_results: maxResults,
      include_answer: true,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (res.status === 429) {
    throw new Error('TAVILY_RATE_LIMIT');
  }
  if (!res.ok) {
    throw new Error(`Tavily API ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const results = (data.results || []).map(r => ({
    title: r.title || '',
    url: r.url || '',
    content: r.content || '',
    score: r.score || 0,
    source: 'tavily',
  }));

  // Include AI-generated answer if available
  if (data.answer) {
    results.unshift({
      title: 'AI Answer',
      url: '',
      content: data.answer,
      score: 1,
      source: 'tavily-ai',
    });
  }

  return results;
}

// ── DuckDuckGo Fallback ─────────────────────────────────────────────────────
/**
 * Search với DuckDuckGo (fallback, 100% free)
 * Dùng duck-duck-scrape library nếu có, fallback sang HTML scraping
 * @param {string} query
 * @param {number} maxResults
 * @returns {Promise<Array<{title, url, content, score}>>}
 */
async function searchDuckDuckGo(query, maxResults = 5) {
  // Thử dùng duck-duck-scrape library trước
  try {
    const { default: DDG } = await import('duck-duck-scrape');
    const results = await DDG.search(query, { safeSearch: 'moderate' });
    if (results?.results?.length > 0) {
      return results.results.slice(0, maxResults).map(r => ({
        title: r.title || '',
        url: r.url || '',
        content: r.description || r.snippet || '',
        score: 0.5,
        source: 'duckduckgo',
      }));
    }
  } catch {
    // Fallback sang HTML scraping
  }

  // Fallback: HTML scraping
  try {
    const DUCKDUCKGO_URL = 'https://html.duckduckgo.com/html/';
    const formData = new URLSearchParams({ q: query });
    const res = await fetch(DUCKDUCKGO_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: formData.toString(),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`);

    const html = await res.text();
    const results = [];
    const resultRegex = /<a rel="nofollow" class="result__a" href="([^"]+)">([^<]+)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    let count = 0;

    while ((match = resultRegex.exec(html)) !== null && count < maxResults) {
      const url = match[1].replace(/amp;/g, '&');
      const title = match[2].replace(/<[^>]+>/g, '').trim();
      const snippet = match[3].replace(/<[^>]+>/g, '').trim();

      if (title && url && !url.includes('duckduckgo.com')) {
        results.push({ title, url, content: snippet, score: 0.5, source: 'duckduckgo' });
        count++;
      }
    }

    return results;
  } catch (err) {
    logger.warn(`[SearchEngine] DuckDuckGo failed: ${err.message}`);
    return [];
  }
}

// ── Jina Reader ──────────────────────────────────────────────────────────────
const JINA_READER_URL = 'https://r.jina.ai/';

/**
 * Đọc sâu web page bằng Jina Reader (Markdown output)
 * @param {string} url
 * @returns {Promise<string>} Markdown content
 */
async function readWebPage(url) {
  try {
    const jinaUrl = JINA_READER_URL + url;
    const res = await fetch(jinaUrl, {
      headers: { 'Accept': 'text/plain', 'X-Return-Format': 'text' },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) throw new Error(`Jina Reader ${res.status}`);

    const content = await res.text();
    // Jina returns markdown, truncate if too long
    return content.length > 8000 ? content.slice(0, 8000) + '\n\n[... truncated]' : content;
  } catch (err) {
    logger.warn(`[SearchEngine] Jina Reader failed for ${url}: ${err.message}`);
    return '';
  }
}

// ── Unified Search ───────────────────────────────────────────────────────────

/**
 * Unified web search với circuit breaker
 * 1. Thử Tavily trước
 * 2. Nếu fail (rate limit, no key) → DuckDuckGo
 * 3. Nếu cả 2 fail → return empty
 *
 * @param {string} query
 * @param {object} opts — { maxResults, useJinaReader }
 * @returns {Promise<Array<{title, url, content, score, source}>>}
 */
export async function searchWeb(query, opts = {}) {
  const { maxResults = 5, useJinaReader = false } = opts;

  if (!query || !query.trim()) return [];

  // ── Layer 1: Tavily ──
  if (TAVILY_API_KEY) {
    try {
      const results = await searchTavily(query, maxResults);
      if (results.length > 0) {
        logger.info(`[SearchEngine] Tavily: ${results.length} results for "${query.slice(0, 40)}"`);
        return results;
      }
    } catch (err) {
      if (err.message === 'TAVILY_RATE_LIMIT') {
        logger.warn('[SearchEngine] Tavily rate limited → falling back to DuckDuckGo');
      } else {
        logger.debug(`[SearchEngine] Tavily failed: ${err.message}`);
      }
    }
  }

  // ── Layer 2: DuckDuckGo Fallback ──
  try {
    const results = await searchDuckDuckGo(query, maxResults);
    if (results.length > 0) {
      logger.info(`[SearchEngine] DuckDuckGo: ${results.length} results for "${query.slice(0, 40)}"`);
      return results;
    }
  } catch (err) {
    logger.debug(`[SearchEngine] DuckDuckGo failed: ${err.message}`);
  }

  logger.warn(`[SearchEngine] No results for "${query.slice(0, 40)}"`);
  return [];
}

/**
 * Đọc web page content (với Jina Reader)
 * @param {string} url
 * @returns {Promise<string>} Markdown content
 */
export async function readWeb(url) {
  return readWebPage(url);
}

/**
 * Search + đọc top result (convenience function)
 * @param {string} query
 * @param {object} opts
 * @returns {Promise<{ results: Array, topContent: string }>}
 */
export async function searchAndRead(query, opts = {}) {
  const results = await searchWeb(query, opts);
  let topContent = '';

  if (results.length > 0 && results[0].url) {
    topContent = await readWebPage(results[0].url);
  }

  return { results, topContent };
}
