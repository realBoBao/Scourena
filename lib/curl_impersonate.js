/**
 * lib/curl_impersonate.js — TLS fingerprint impersonation for bypassing Cloudflare
 *
 * Dùng curl-impersonate để giả lập chữ ký TLS của Chrome/Firefox.
 * Cho phép truy cập các site bị Cloudflare block (403 Forbidden).
 *
 * Yêu cầu: curl-impersonate binary được cài đặt trên VPS
 *   Ubuntu: sudo apt install curl-impersonate
 *   Hoặc build từ source: https://github.com/lwthiker/curl-impersonate
 *
 * @module lib/curl_impersonate
 */

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { getLogger } from './logger.js';

const logger = getLogger('CurlImpersonate');

let _available = null;

/**
 * Check if curl-impersonate is available
 * @returns {boolean}
 */
export function isAvailable() {
  if (_available !== null) return _available;

  try {
    const result = spawnSync('curl-impersonate', ['--version'], { encoding: 'utf8', timeout: 5000 });
    _available = result.status === 0;
  } catch {
    _available = false;
  }

  if (!_available) {
    // Try common paths
    const paths = [
      '/usr/bin/curl-impersonate',
      '/usr/local/bin/curl-impersonate',
      '/opt/curl-impersonate/bin/curl-impersonate',
    ];
    for (const p of paths) {
      if (existsSync(p)) {
        _available = true;
        break;
      }
    }
  }

  return _available;
}

/**
 * Fetch URL with TLS fingerprint impersonation
 * @param {string} url
 * @param {Object} options
 * @param {string} options.browser — 'chrome' (default) hoặc 'firefox'
 * @param {Object} options.headers — Additional headers
 * @param {number} options.timeout — Timeout in seconds
 * @returns {{ status, body, error }}
 */
export function fetchWithImpersonation(url, { browser = 'chrome', headers = {}, timeout = 20 } = {}) {
  if (!isAvailable()) {
    return { status: 0, body: '', error: 'curl-impersonate not installed' };
  }

  const impersonateFlag = browser === 'firefox' ? '--impersonate firefox' : '--impersonate chrome';
  const args = [
    impersonateFlag,
    '-s', // silent
    '-L', // follow redirects
    `--max-time ${timeout}`,
    '-w', '\\n%{http_code}', // append status code
  ];

  // Add headers
  for (const [key, value] of Object.entries(headers)) {
    args.push('-H', `${key}: ${value}`);
  }

  args.push(url);

  try {
    const result = spawnSync('curl-impersonate', args, {
      encoding: 'utf8',
      timeout: (timeout + 5) * 1000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.error) {
      return { status: 0, body: '', error: result.error.message };
    }

    const output = result.stdout || '';
    const lines = output.split('\n');
    const status = parseInt(lines.pop() || '0', 10);
    const body = lines.join('\n');

    return { status, body, error: null };
  } catch (err) {
    return { status: 0, body: '', error: err.message };
  }
}

/**
 * Fetch URL with auto-fallback: impersonate → native fetch
 * @param {string} url
 * @param {Object} options
 * @returns {Promise<{status, body, error}>}
 */
export async function fetchWithFallback(url, options = {}) {
  // Try impersonation first
  if (isAvailable()) {
    const result = fetchWithImpersonation(url, options);
    if (result.status === 200 && !result.error) {
      return result;
    }
    logger.warn(`[CurlImpersonate] Failed (${result.status}), falling back to native fetch`);
  }

  // Fallback to native fetch
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), (options.timeout || 20) * 1000);

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        ...options.headers,
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    const body = await res.text();
    return { status: res.status, body, error: null };
  } catch (err) {
    return { status: 0, body: '', error: err.message };
  }
}

export default { isAvailable, fetchWithImpersonation, fetchWithFallback };
