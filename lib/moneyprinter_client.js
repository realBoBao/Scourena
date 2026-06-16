/**
 * lib/moneyprinter_client.js — MoneyPrinterTurbo API client
 *
 * Tier 2: Video generation via MoneyPrinterTurbo
 * MPT là Python service, nên dùng HTTP API để gọi từ Node.js
 *
 * Setup: pip install MoneyPrinterTurbo && python -m moneyprinter.server
 * API: POST /api/v1/video → { task_id }
 *      GET  /api/v1/video/:id → { status, url }
 */

import { getLogger } from './logger.js';
const logger = getLogger('MoneyPrinter');

const MPT_URL = process.env.MONEYPRINTER_URL || 'http://localhost:8080';

export async function generateVideo(script, options = {}) {
  try {
    const res = await fetch(`${MPT_URL}/api/v1/video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script, voice: options.voice || 'vi-VN', duration: options.duration || 60 }),
    });
    if (!res.ok) throw new Error(`MPT API ${res.status}`);
    return await res.json();
  } catch (err) {
    logger.warn('[MoneyPrinter] Video generation failed:', err.message);
    return { error: err.message };
  }
}

export async function getVideoStatus(taskId) {
  try {
    const res = await fetch(`${MPT_URL}/api/v1/video/${taskId}`);
    return await res.json();
  } catch (err) {
    return { error: err.message };
  }
}
