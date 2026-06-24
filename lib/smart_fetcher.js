/**
 * lib/smart_fetcher.js — Shared smart fetch utility for all scrapers
 *
 * Dùng chung cho: job_scraper, tech_news_webhook, algo_webhook, nightly_scraper
 * - Auto retry khi 429/5xx
 * - Rate-limit (maxConcurrency)
 * - MemoryStorage (không ghi disk)
 * - curl-impersonate fallback cho Cloudflare-protected sites
 * - Python web scraper fallback cho complex HTML pages
 *
 * @module lib/smart_fetcher
 */

import { CheerioCrawler, Configuration, MemoryStorage } from 'crawlee';

const DEFAULT_CONFIG = {
  maxConcurrency: 5,
  maxRequestRetries: 3,
  requestHandlerTimeoutSecs: 30,
};

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * Fetch JSON API với retry (dùng cho HN Algolia, GitHub API, RemoteOK, LeetCode)
 * @param {string} url
 * @param {Object} options
 * @param {number} options.retries
 * @param {number} options.timeout
 * @param {string} options.method — 'GET' (default) hoặc 'POST'
 * @param {Object} options.body — POST body (JSON)
 * @returns {Promise<Object>} JSON response
 */
export async function fetchJson(url, { retries = 3, timeout = 20000, headers = {}, method = 'GET', body } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const fetchOptions = {
        method,
        headers: { 'User-Agent': USER_AGENT, ...headers },
        signal: controller.signal,
      };
      if (body) fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
      const res = await fetch(url, fetchOptions);
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === retries) {
        console.warn(`[SmartFetcher] fetchJson failed after ${retries + 1} attempts: ${url} — ${err.message}`);
        return null;
      }
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

/**
 * Fetch text (HTML/XML/plain) với retry + curl-impersonate fallback
 * @param {string} url
 * @param {Object} options
 * @returns {Promise<string>} Text response
 */
export async function fetchText(url, { retries = 3, timeout = 20000, headers = {} } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, ...headers },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt === retries) {
        // Fallback to curl-impersonate for Cloudflare-protected sites
        try {
          const { fetchWithFallback } = await import('./curl_impersonate.js');
          const result = await fetchWithFallback(url, { timeout, headers });
          if (result.status === 200 && result.body) {
            console.log(`[SmartFetcher] curl-impersonate fallback succeeded for ${url}`);
            return result.body;
          }
        } catch { /* ignore fallback error */ }

        console.warn(`[SmartFetcher] fetchText failed after ${retries + 1} attempts: ${url} — ${err.message}`);
        return '';
      }
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

/**
 * Crawl HTML page với CheerioCrawler (cho web pages phức tạp)
 * @param {string} url
 * @param {Function} extractFn — ($, url) => result | null
 * @param {Object} options
 * @returns {Promise<Array>} Kết quả từ extractFn
 */
export async function crawlHtml(url, extractFn, { maxConcurrency = 3, maxRetries = 2 } = {}) {
  try {
    const config = new Configuration({
      storageClient: new MemoryStorage(),
      purgeOnStart: true,
    });

    const results = [];
    const crawler = new CheerioCrawler({
      maxConcurrency,
      maxRequestRetries: maxRetries,
      requestHandlerTimeoutSecs: DEFAULT_CONFIG.requestHandlerTimeoutSecs,
      preNavigationHooks: [
        ({ request }) => {
          request.headers = {
            ...request.headers,
            'User-Agent': USER_AGENT,
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          };
        },
      ],
    }, config);

    crawler.requestHandler = async ({ $, request }) => {
      try {
        const result = extractFn($, request.url);
        if (result) {
          if (Array.isArray(result)) results.push(...result);
          else results.push(result);
        }
      } catch { /* skip bad items */ }
    };

    await crawler.run([url]);
    return results;
  } catch (err) {
    console.warn(`[SmartFetcher] crawlHtml failed for ${url}:`, err.message);
    return [];
  }
}

/**
 * Crawl nhiều URLs cùng lúc (song song)
 * @param {string[]} urls
 * @param {Function} extractFn
 * @param {Object} options
 * @returns {Promise<Array>}
 */
export async function crawlMultiple(urls, extractFn, options = {}) {
  const results = await Promise.all(
    urls.map(url => crawlHtml(url, extractFn, options))
  );
  return results.flat();
}

/**
 * Scrape web page and convert to Markdown (Python fallback)
 * @param {string} url
 * @param {number} maxLength
 * @returns {Promise<{url, title, markdown, error}>}
 */
export async function scrapeWebPage(url, maxLength = 10000) {
  try {
    const { spawnSync } = await import('child_process');
    const { join } = await import('path');
    const script = join(process.cwd(), 'scripts', 'web_scraper.py');

    const result = spawnSync(
      'python', [script, '--url', url, '--max-length', String(maxLength)],
      { timeout: 30000, maxBuffer: 10 * 1024 * 1024, encoding: 'utf8',
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }
    );

    if (result.error) throw result.error;
    return JSON.parse(result.stdout || '{}');
  } catch (err) {
    console.warn(`[SmartFetcher] scrapeWebPage failed for ${url}:`, err.message);
    return { url, title: '', markdown: '', error: err.message };
  }
}

export default { fetchJson, fetchText, crawlHtml, crawlMultiple, scrapeWebPage };
