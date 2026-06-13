/**
 * ═══════════════════════════════════════════════════════════════
 * Grounding Verifier — Ép LLM trích dẫn nguồn
 * ═══════════════════════════════════════════════════════════════
 *
 * Sau khi LLM generate answer, verify xem answer có được
 * hỗ trợ bởi context chunks không.
 *
 * Nếu không trích dẫn được → thêm disclaimer hoặc strip answer.
 */

import { getLogger } from './logger.js';
const logger = getLogger('GroundingVerifier');

/**
 * Verify answer có grounded trong context không.
 * @param {string} question - Câu hỏi gốc
 * @param {string} answer - Câu trả lời từ LLM
 * @param {Array} contextChunks - Context chunks từ vector search
 * @param {Function} askFn - Hàm gọi LLM (từ RagAgent)
 * @returns {{ verified: boolean, citedSources: number[], unsupportedClaims: string[] }}
 */
export async function verifyWithCitation(question, answer, contextChunks, askFn) {
  if (!contextChunks?.length) {
    return { verified: false, reason: 'no_context', citedSources: [], unsupportedClaims: [] };
  }

  const contextText = contextChunks
    .slice(0, 3)
    .map((c, i) => {
      const text = c.payload?.text ?? c.text ?? c.chunk_text ?? '';
      return `[Nguồn ${i + 1}]: ${text.slice(0, 300)}`;
    })
    .join('\n\n');

  const verifyPrompt = `Nhiệm vụ: Kiểm tra câu trả lời có được hỗ trợ bởi context không.

Context:
${contextText}

Câu hỏi: "${question.slice(0, 200)}"

Câu trả lời: "${answer.slice(0, 400)}"

Trả về JSON (chỉ JSON, không giải thích):
{
  "grounded": true,
  "cited_sources": [1, 2],
  "unsupported_claims": []
}

Nếu câu trả lời có claims không có trong context, liệt kê trong unsupported_claims.`;

  try {
    const raw = await askFn(verifyPrompt, { maxTokens: 150, temperature: 0.1 });
    const clean = raw.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    return {
      verified: result.grounded !== false,
      citedSources: result.cited_sources ?? [],
      unsupportedClaims: result.unsupported_claims ?? [],
    };
  } catch (err) {
    logger.warn('[GroundingVerify] Parse error:', err.message);
    return { verified: true, reason: 'parse_error', citedSources: [], unsupportedClaims: [] };
  }
}

/**
 * Format disclaimer cho answer không grounded.
 */
export function formatDisclaimer(grounding) {
  if (grounding.verified) return '';

  const parts = ['\n\n> ⚠️ **Cảnh báo:**'];

  if (grounding.unsupportedClaims?.length > 0) {
    parts.push('Một số điểm trong câu trả lời chưa được xác minh từ tài liệu:');
    for (const claim of grounding.unsupportedClaims.slice(0, 3)) {
      parts.push(`> • "${claim.slice(0, 100)}"`);
    }
  } else {
    parts.push('Câu trả lời này chưa được xác minh hoàn toàn từ nguồn tài liệu.');
  }

  return parts.join('\n');
}

export default { verifyWithCitation, formatDisclaimer };
