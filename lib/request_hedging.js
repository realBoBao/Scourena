/**
 * lib/request_hedging.js — Request Hedging / Tailing (Tier 3)
 * Bắt chước Google: nếu request chậm, bắn song parallel request thứ 2.
 * Request nào về trước lấy, request còn lại abort.
 * @module lib/request_hedging
 */

/**
 * Gọi request với hedging.
 * Nếu request chậm hơn hedgeDelay, bắn thêm request song song.
 * @param {Function} fn — Async function (nhận AbortSignal)
 * @param {Object} opts
 * @param {number} opts.hedgeDelay — Delay trước khi bắn hedge (ms), mặc định 1500
 * @param {number} opts.timeout — Timeout tổng (ms), mặc định 10000
 * @returns {Promise<any>}
 */
export async function hedge(fn, opts = {}) {
  const { hedgeDelay = 1500, timeout = 10000 } = opts;

  // Request 1
  const ctrl1 = new AbortController();
  const timer = setTimeout(() => ctrl1.abort(), timeout);

  let result1 = null;
  let error1 = null;
  let done1 = false;

  const p1 = fn(ctrl1.signal).then(r => { result1 = r; done1 = true; return r; }).catch(e => { error1 = e; done1 = true; throw e; });

  // Chờ hedgeDelay
  await new Promise(r => setTimeout(r, hedgeDelay));

  // Nếu request 1 chưa xong → bắn request 2 song song
  if (!done1) {
    console.warn(`[Hedge] Primary request slow after ${hedgeDelay}ms, firing hedge request`);
    const ctrl2 = new AbortController();
    const p2 = fn(ctrl2.signal).then(r => {
      // Request 2 về trước → abort request 1
      ctrl1.abort();
      clearTimeout(timer);
      console.warn('[Hedge] Hedge request won');
      return r;
    }).catch(e => {
      // Request 2 fail → chờ request 1
      return p1;
    });

    try {
      return await Promise.any([p1, p2]);
    } catch {
      // Cả 2 fail → throw error đầu tiên
      throw error1;
    }
  }

  // Request 1 đã xong trước hedgeDelay → trả về luôn
  clearTimeout(timer);
  return result1;
}
