/**
 * lib/vad_state.js — Voice Activity Detection & Study State Machine (Tier 1)
 * Quản lý trạng thái voice: chỉ kích hoạn khi có giọng nói thực.
 * Chế độ học: bot im lặng khi user đang học.
 * @module lib/vad_state
 */

import { getLogger } from './logger.js';
const logger = logger = getLogger('VADState');

// ── Study State Machine ──
const _userStates = new Map(); // userId → { isStudying: boolean, lastActivity: number }

/**
 * Set study state cho user.
 * @param {string} userId
 * @param {boolean} isStudying
 */
export function setStudyState(userId, isStudying) {
  _userStates.set(userId, {
    isStudying,
    lastActivity: Date.now(),
  });
  logger.info(`[VADState] User ${userId}: ${isStudying ? 'STUDYING' : 'IDLE'}`);
}

/**
 * Kiểm tra user đang học không.
 * @param {string} userId
 * @returns {boolean}
 */
export function isStudying(userId) {
  const state = _userStates.get(userId);
  return state?.isStudying || false;
}

/**
 * Lấy trạng thái user.
 * @param {string} userId
 */
export function getUserState(userId) {
  return _userStates.get(userId) || { isStudying: false, lastActivity: 0 };
}

// ── Simple VAD (Energy-based) ──
// Không cần model phức tạp — chỉ cần đo energy level của audio buffer

/**
 * Kiểm tra audio buffer có chứa giọng nói không.
 * Dùng RMS energy threshold đơn giản.
 * @param {Buffer} audioBuffer — Raw audio data (PCM 16-bit)
 * @param {number} threshold — Energy threshold (mặc định 500)
 * @returns {boolean}
 */
export function hasVoiceActivity(audioBuffer, threshold = 500) {
  if (!audioBuffer || audioBuffer.length < 2) return false;

  // Tính RMS energy
  let sum = 0;
  const samples = audioBuffer.length / 2; // 16-bit = 2 bytes per sample
  for (let i = 0; i < audioBuffer.length; i += 2) {
    const sample = audioBuffer.readInt16LE(i);
    sum += sample * sample;
  }
  const rms = Math.sqrt(sum / samples);

  return rms > threshold;
}

/**
 * Xử lý voice activity cho user.
 * Nếu user đang học và không có wake word → bỏ qua.
 * @param {string} userId
 * @param {Buffer} audioBuffer
 * @param {string} transcript — Text từ Whisper (nếu có)
 * @returns {{ shouldProcess: boolean, reason: string }}
 */
export function processVoice(userId, audioBuffer, transcript = '') {
  // Kiểm tra VAD
  const hasVoice = hasVoiceActivity(audioBuffer);
  if (!hasVoice) {
    return { shouldProcess: false, reason: 'no_voice' };
  }

  // Kiểm tra study state
  if (isStudying(userId)) {
    // Chỉ xử lý nếu có wake word
    const wakeWords = ['serena', 'hey serena', 'ok serena', 'serena ơi'];
    const lowerTranscript = transcript.toLowerCase();
    const hasWakeWord = wakeWords.some(w => lowerTranscript.includes(w));

    if (!hasWakeWord) {
      logger.debug(`[VADState] User ${userId} studying, ignoring non-wake-word`);
      return { shouldProcess: false, reason: 'studying_no_wake_word' };
    }

    logger.info(`[VADState] Wake word detected from studying user ${userId}`);
  }

  // Update last activity
  const state = _userStates.get(userId) || { isStudying: false, lastActivity: 0 };
  state.lastActivity = Date.now();
  _userStates.set(userId, state);

  return { shouldProcess: true, reason: 'ok' };
}

/**
 * Xóa state cũ (cleanup định kỳ).
 * @param {number} maxAge — Thời gian tối đa giữ state (ms), mặc định 1 giờ
 */
export function cleanupOldStates(maxAge = 3600000) {
  const now = Date.now();
  for (const [userId, state] of _userStates) {
    if (now - state.lastActivity > maxAge) {
      _userStates.delete(userId);
    }
  }
}

// Auto-cleanup mỗi 10 phút
setInterval(() => cleanupOldStates(), 600000);
