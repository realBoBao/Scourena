/**
 * lib/document_parser.js — Node.js bridge to Python HTML-to-Markdown converter
 *
 * Gọi script Python để clean HTML/file → Markdown trước khi nhồi vào RAG.
 * Fallback nếu Python fail: trả về text gốc.
 *
 * @module lib/document_parser
 */

import { spawnSync } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';

const logger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

// Use cwd-based path (works in both ESM and CJS)
const PYTHON_SCRIPT = join(process.cwd(), 'scripts', 'html_to_markdown.py');

// Find Python executable — hardcode for Windows
const PYTHON = 'C:\\Users\\bogia\\AppData\\Local\\Programs\\Python\\Python312\\python.exe';

// Debug: log resolved paths
console.log('[DocumentParser] PYTHON:', PYTHON);
console.log('[DocumentParser] PYTHON_SCRIPT:', PYTHON_SCRIPT);
console.log('[DocumentParser] PYTHON exists:', existsSync(PYTHON));
console.log('[DocumentParser] SCRIPT exists:', existsSync(PYTHON_SCRIPT));

function runPython(pyArgs) {
  try {
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
    // Use spawnSync with array args to avoid shell escaping issues
    // pyArgs should NOT include PYTHON_SCRIPT — we prepend it here
    const result = spawnSync(PYTHON, [PYTHON_SCRIPT, ...pyArgs], {
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8',
      env,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Python exit code ${result.status}: ${result.stderr}`);
    }
    return result.stdout || '';
  } catch (err) {
    throw new Error(`Python exec failed: ${err.message}`);
  }
}

/**
 * Convert HTML string to clean Markdown.
 * @param {string} html
 * @returns {Promise<string>} markdown
 */
export async function htmlToMarkdown(html) {
  try {
    const stdout = await runPython(['--html', html]);
    return stdout.trim();
  } catch (err) {
    logger.warn('[DocumentParser] htmlToMarkdown failed, returning raw text:', err.message);
    // Fallback: strip HTML tags
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

/**
 * Convert file to clean Markdown.
 * Supports: .html, .htm, .txt, .xml, .rss
 * @param {string} filepath
 * @returns {Promise<string>} markdown
 */
export async function fileToMarkdown(filepath) {
  try {
    const stdout = await runPython([filepath]);
    return stdout.trim();
  } catch (err) {
    logger.warn(`[DocumentParser] fileToMarkdown failed for ${filepath}:`, err.message);
    // Fallback: read as text
    try {
      const { readFile } = await import('fs/promises');
      return await readFile(filepath, 'utf8');
    } catch {
      return '';
    }
  }
}

const WEB_SCRIPT = join(process.cwd(), 'scripts', 'web_scraper.py');

/**
 * Scrape web page and convert to Markdown.
 * @param {string} url
 * @param {number} maxLength
 * @returns {Promise<{url, title, markdown, error}>}
 */
export async function scrapeUrl(url, maxLength = 10000) {
  try {
    const result = spawnSync(PYTHON, [WEB_SCRIPT, '--url', url, '--max-length', String(maxLength)], {
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    if (result.error) throw result.error;
    return JSON.parse(result.stdout || '{}');
  } catch (err) {
    logger.warn(`[DocumentParser] scrapeUrl failed for ${url}:`, err.message);
    return { url, title: '', markdown: '', error: err.message };
  }
}

export default { htmlToMarkdown, fileToMarkdown };
