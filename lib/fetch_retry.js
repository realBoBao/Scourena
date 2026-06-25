/**
 * lib/fetch_retry.js — Fetch with retry logic
 * @module lib/fetch_retry
 */

/**
 * Fetch with automatic retry
 */
export async function fetchRetry(url, options = {}, { retries = 3, baseDelay = 1000 } = {}) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || res.status < 500) return res;
      if (i === retries) return res;
    } catch (err) {
      if (i === retries) throw err;
    }
    await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, i)));
  }
}

export default { fetchRetry };
