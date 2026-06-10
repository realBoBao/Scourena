/**
 * ═══════════════════════════════════════════════════════════════
 * Source Analyzer — Shared module cho RagAgent + Pipeline
 * ═══════════════════════════════════════════════════════════════
 *
 * Chứa các hàm dùng chung:
 * - detectExternalSource() — Nhận diện domain từ URL
 * - calculateSourceScore() — Tính điểm chất lượng nguồn (0-1)
 * - isHighValueStudy() — Đánh dấu tài liệu chất lượng cao
 * - embedChunksSafe() — Embed batch với chống 413/rate limit
 * - preCheckRelevanceWithLLM() — Gatekeeper LLM cho relevance
 */

// ── URL Parser — Nhận diện domain đích từ URL ──
export function detectExternalSource(url) {
  if (!url) return '';
  const u = url.toLowerCase();
  if (u.includes('github.com')) return '[GitHub]';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return '[YouTube]';
  if (u.includes('medium.com') || u.includes('dev.to') || u.includes('hashnode')) return '[Blog]';
  if (u.includes('arxiv.org')) return '[arXiv]';
  if (u.includes('stackoverflow.com')) return '[StackOverflow]';
  if (u.includes('docs.google.com') || u.includes('drive.google.com')) return '[GoogleDocs]';
  if (u.includes('notion.so') || u.includes('notion.site')) return '[Notion]';
  if (u.includes('figma.com')) return '[Figma]';
  if (u.includes('twitter.com') || u.includes('x.com')) return '[Twitter]';
  if (u.includes('linkedin.com')) return '[LinkedIn]';
  return '';
}

export function extractDomainTag(tag) {
  if (!tag) return '';
  return tag.replace(/[\[\]]/g, '').toLowerCase();
}

// ── Score Calculator — Tính điểm chất lượng nguồn (0-1) ──
export function calculateSourceScore({ type, stars, views, points, relevanceConfidence, isRelevant }) {
  let score = 0.6;

  switch (type) {
    case 'repo':
      if (stars) score = Math.min(1.0, Math.log10(stars + 1) / 5);
      break;
    case 'video':
      if (views) score = Math.min(1.0, Math.log10(views + 1) / 6);
      break;
    case 'reddit':
      if (points) score = Math.min(1.0, Math.log10(points + 1) / 3.0);
      break;
    case 'stackoverflow':
      if (points) score = Math.min(1.0, Math.log10(points + 1) / 2.5);
      break;
    case 'hackernews':
      if (points) score = Math.min(1.0, Math.log10(points + 1) / 3.0);
      break;
    case 'arxiv':
      score = 0.75;
      break;
    default:
      score = 0.6;
  }

  if (isRelevant === false) score *= 0.5;
  if (relevanceConfidence === 'high') score *= 1.1;
  if (relevanceConfidence === 'low') score *= 0.85;

  return Math.min(1.0, Math.max(0, score));
}

// ── Active Recall Flagging ──
const HIGH_VALUE_THRESHOLD = 0.85;

export function isHighValueStudy(score) {
  return score >= HIGH_VALUE_THRESHOLD;
}

// ── Tối ưu hóa API: Chia nhỏ Batch để chống lỗi 413 ──
export async function embedChunksSafe(chunks, embedTextsBatch, embedText) {
  const MAX_BATCH_SIZE = 100;
  const allEmbeddings = [];

  try {
    for (let i = 0; i < chunks.length; i += MAX_BATCH_SIZE) {
      const batch = chunks.slice(i, i + MAX_BATCH_SIZE);
      const batchEmbeddings = await embedTextsBatch(batch);
      allEmbeddings.push(...batchEmbeddings);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    return allEmbeddings;
  } catch (err) {
    console.warn('[embedChunksSafe] Batch failed, falling back to per-chunk:', err?.message || err);
    const fallbackEmbeddings = [];
    for (const c of chunks) {
      fallbackEmbeddings.push(await embedText(c));
    }
    return fallbackEmbeddings;
  }
}

// ── Pre-check Relevance với LLM ──
export async function preCheckRelevanceWithLLM(title, description) {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.Google_API_KEY;
  if (!apiKey) {
    console.warn('[preCheckRelevance] GOOGLE_API_KEY not set, using heuristic fallback');
    return heuristicRelevance(title, description);
  }

  const systemPrompt = `You are a Senior Tech Lead evaluating technical content. Distinguish SOFTWARE ENGINEERING content from non-technical content.

CRITICAL: "System Design" in SOFTWARE ENGINEERING = Distributed systems, APIs, databases, microservices, cloud architecture. In OTHER DOMAINS = Architecture, interior design, building structures.

Return JSON: {"isRelevant": boolean, "confidence": 0-100, "reason": "brief"}`;

  const userPrompt = `Title: "${title}"\nDescription: "${description}"\nIs this software engineering content?`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`;
    const body = {
      system: [{ text: systemPrompt }],
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 200 },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) return heuristicRelevance(title, description);
    const j = await res.json();
    const raw = j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const match = String(raw).match(/\{[\s\S]*\}$/m);
    if (!match) return heuristicRelevance(title, description);
    const parsed = JSON.parse(match[0]);
    let confidenceStr = 'medium';
    if (typeof parsed.confidence === 'number') {
      confidenceStr = parsed.confidence >= 70 ? 'high' : parsed.confidence >= 40 ? 'medium' : 'low';
    } else if (typeof parsed.confidence === 'string') {
      confidenceStr = parsed.confidence;
    }
    const score = (typeof parsed.score === 'number' && !isNaN(parsed.score))
      ? Math.max(0, Math.min(1, parsed.score))
      : (parsed.isRelevant ? 0.6 : 0.2);
    return {
      isRelevant: Boolean(parsed.isRelevant),
      confidence: confidenceStr,
      reason: String(parsed.reason || 'No reason'),
      score,
    };
  } catch (err) {
    console.warn('[preCheckRelevance] LLM failed, fallback to heuristic');
    return heuristicRelevance(title, description);
  }
}

// ── Heuristic Relevance (fallback) ──
function heuristicRelevance(title, description) {
  const text = `${title || ''} ${description || ''}`.toLowerCase();

  const strongNegative = [
    'vlog', 'music', 'song', 'singer', 'musician', 'movie', 'film', 'trailer',
    'funny', 'meme', 'prank', 'cute', 'pet', 'animal', 'cooking', 'recipe', 'food',
    'makeup', 'beauty', 'fashion', 'shopping', 'haul', 'unboxing', 'review',
    'family', 'kids', 'baby', 'child', 'home decor', 'interior', 'roof', 'canopy',
    'fitness', 'workout', 'gym', 'yoga', 'dance', 'choreography', 'entertainment',
  ];

  const strongPositive = [
    'software', 'backend', 'frontend', 'devops', 'api', 'algorithm', 'code',
    'programming', 'developer', 'database', 'microservices', 'docker', 'kubernetes',
    'cloud computing', 'web development', 'deploy', 'infrastructure', 'coding interview',
    'system design', 'distributed systems', 'scalability', 'performance optimization',
    'load balancing', 'caching strategies', 'cloud architecture', 'software architecture',
    'multithreading', 'concurrency', 'memory management', 'data structures', 'algorithm analysis',
    'network bottleneck', 'networking', 'tcp', 'http', 'protocol', 'server', 'latency',
    'throughput', 'bandwidth', 'firewall', 'load balancer', 'reverse proxy', 'cdn',
  ];

  if (strongNegative.some(t => text.includes(t)) && !strongPositive.some(t => text.includes(t))) {
    return { isRelevant: false, confidence: 'high', reason: 'Non-technical content', score: 0.2 };
  }

  if (strongPositive.some(t => text.includes(t))) {
    return { isRelevant: true, confidence: 'medium', reason: 'Technical content', score: 0.7 };
  }

  const weakPositive = ['system', 'design', 'architecture', 'learning', 'tutorial', 'course', 'engineering'];
  const weakCount = weakPositive.filter(t => text.includes(t)).length;
  if (weakCount >= 2) {
    return { isRelevant: true, confidence: 'low', reason: 'Weak technical keywords', score: 0.5 };
  }

  return { isRelevant: false, confidence: 'medium', reason: 'Insufficient technical indicators', score: 0.3 };
}
