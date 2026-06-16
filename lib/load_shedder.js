/**
 * lib/load_shedder.js — Load Shedding & Backpressure (Tier 4)
 * Khi CPU/RAM vượt ngưỡng, chủ động từ chối request mới để bảo vệ hệ thống.
 * Giống WeChat/Netflix: "Vứt bỏ để sống sót".
 * @module lib/load_shedder
 */

import { getLogger } from './logger.js';
const logger = getLogger('LoadShedder');

const CPU_THRESHOLD = 85; // %
const MEM_THRESHOLD = 85; // %
const CHECK_INTERVAL = 5000; // ms

let _enabled = true;
let _lastCheck = 0;
let _lastStatus = { cpu: 0, mem: 0, shedding: false };

/**
 * Kiểm tra áp lực hệ thống.
 * @returns {{ cpu: number, mem: number, shedding: boolean }}
 */
export function checkPressure() {
  if (!_enabled) return { cpu: 0, mem: 0, shedding: false };

  const now = Date.now();
  if (now - _lastCheck < CHECK_INTERVAL) return _lastStatus;

  // Memory usage
  const memUsage = process.memoryUsage();
  const memPercent = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);

  // CPU usage (approximate via process.cpuUsage)
  const cpuUsage = process.cpuUsage();
  const cpuPercent = Math.round((cpuUsage.user + cpuUsage.system) / 1000000); // rough estimate

  const shedding = cpuPercent > CPU_THRESHOLD || memPercent > MEM_THRESHOLD;

  _lastStatus = { cpu: cpuPercent, mem: memPercent, shedding };
  _lastCheck = now;

  if (shedding) {
    logger.warn(`[LoadShedder] HIGH PRESSURE — CPU: ${cpuPercent}%, MEM: ${memPercent}% — shedding requests`);
  }

  return _lastStatus;
}

/**
 * Kiểm tra request có được chấp nhận không.
 * @returns {boolean}
 */
export function shouldAccept() {
  const status = checkPressure();
  return !status.shedding;
}

/**
 * Lấy trạng thái hiện tại.
 */
export function getStatus() {
  return { ..._lastStatus, enabled: _enabled };
}

/**
 * Bật/tắt load shedder.
 * @param {boolean} enabled
 */
export function setEnabled(enabled) {
  _enabled = enabled;
}
