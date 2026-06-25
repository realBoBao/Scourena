/**
 * lib/vad_state.js — Voice Activity Detection & Study State
 * Stub implementation — VAD processing handled by VoiceAgent directly
 * @module lib/vad_state
 */

// Study state per user
const _studyState = new Map();

/**
 * Set study state for a user
 */
export function setStudyState(userId, state) {
  _studyState.set(userId, { ...state, updatedAt: Date.now() });
}

/**
 * Check if user is in study mode
 */
export function isStudying(userId) {
  const state = _studyState.get(userId);
  if (!state) return false;
  // Expire after 30 minutes of inactivity
  if (Date.now() - state.updatedAt > 30 * 60 * 1000) {
    _studyState.delete(userId);
    return false;
  }
  return state.active === true;
}

/**
 * Process voice data (stub — actual processing in VoiceAgent)
 */
export function processVoice(userId, audioBuffer) {
  // Stub: VoiceAgent handles actual voice processing
  return { success: false, message: 'Use VoiceAgent.processVoice() instead' };
}

export default { setStudyState, isStudying, processVoice };
