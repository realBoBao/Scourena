/**
 * lib/content_quality.js — Lightweight quality scoring for cron jobs
 *
 * Shared by: tech_news_webhook.js, job_scraper.js, algo_webhook.js
 * No DB dependency — pure heuristic scoring.
 *
 * Usage:
 *   import { scoreContent, formatQualityBar } from './lib/content_quality.js';
 *   const result = scoreContent({ title, url, source, points });
 *   // result: { score: 0-1, level: 'high'|'medium'|'low', tag: '[🔥]'|'[📦]'|'[📄]' }
 */

// ── Source reputation scores (well-known domains) ──
const SOURCE_REPUTATION = {
  // Tier 1: High trust (official, well-curated)
  'github.com': 0.95,
  'arxiv.org': 0.95,
  'news.ycombinator.com': 0.90,
  'stackoverflow.com': 0.85,
  'leetcode.com': 0.90,

  // Tier 2: Good quality (curated job boards)
  'simplifyjobs.com': 0.85,
  'remoteok.com': 0.80,
  'weworkremotely.com': 0.80,
  'greenhouse.io': 0.80,
  'lever.co': 0.80,
  'ashbyhq.com': 0.80,

  // Tier 3: Medium (social, variable quality)
  'reddit.com': 0.60,
  'twitter.com': 0.50,
  'x.com': 0.50,
  'linkedin.com': 0.65,
  'youtube.com': 0.55,

  // Tier 4: Low (aggregators, spam risk)
  'indeed.com': 0.45,
  'glassdoor.com': 0.45,
  'ziprecruiter.com': 0.40,
};

// ── Quality keywords ──
const QUALITY_POSITIVE = [
  'open source', 'release', 'launch', 'announce', 'introducing',
  'breaking', 'update', 'security', 'patch', 'cve',
  'performance', 'benchmark', 'optimization', 'scalability',
  'architecture', 'distributed', 'microservices', 'kubernetes',
  'rust', 'golang', 'typescript', 'wasm',
];

const QUALITY_NEGATIVE = [
  'clickbait', 'you won\'t believe', 'shocking', 'exposed',
  'scam', 'fake', 'spam', 'ad', 'sponsored',
  'gift card', 'free money', 'crypto giveaway',
];

/**
 * Score content quality based on source + metadata.
 *
 * @param {Object} params
 * @param {string} params.title — Content title
 * @param {string} params.url — Content URL
 * @param {string} params.source — Source tag (e.g., 'HN', 'GitHub', 'SimplifyJobs')
 * @param {number} [params.points] — Upvotes/points if available
 * @param {number} [params.stars] — GitHub stars if available
 * @param {string} [params.description] — Optional description text
 * @returns {{ score: number, level: string, tag: string, reasons: string[] }}
 */
export function scoreContent({ title = '', url = '', source = '', points = 0, stars = 0, description = '' }) {
  const reasons = [];
  let score = 0.5; // baseline

  // Signal 1: Source reputation
  const domain = extractDomain(url);
  const sourceScore = SOURCE_REPUTATION[domain] ?? 0.50;
  score = score * 0.5 + sourceScore * 0.5;
  if (sourceScore >= 0.85) reasons.push(`trusted_source(${domain})`);
  else if (sourceScore < 0.50) reasons.push(`low_trust(${domain})`);

  // Signal 2: Community engagement
  if (points > 0) {
    const pointScore = Math.min(1, Math.log10(points + 1) / 3.5);
    score += pointScore * 0.15;
    if (points > 100) reasons.push(`high_engagement(${points}pts)`);
  }
  if (stars > 0) {
    const starScore = Math.min(1, Math.log10(stars + 1) / 4);
    score += starScore * 0.15;
    if (stars > 500) reasons.push(`popular_repo(${stars}★)`);
  }

  // Signal 3: Title quality keywords
  const text = `${title} ${description}`.toLowerCase();
  const positiveHits = QUALITY_POSITIVE.filter(k => text.includes(k)).length;
  const negativeHits = QUALITY_NEGATIVE.filter(k => text.includes(k)).length;
  score += positiveHits * 0.03;
  score -= negativeHits * 0.15;
  if (positiveHits >= 2) reasons.push('quality_keywords');
  if (negativeHits > 0) reasons.push('low_quality_keywords');

  // Signal 4: Title length (too short = low quality)
  if (title.length < 15) {
    score -= 0.1;
    reasons.push('title_too_short');
  } else if (title.length > 40) {
    score += 0.03;
    reasons.push('descriptive_title');
  }

  // Clamp
  score = Math.max(0, Math.min(1, score));

  // Level + visual tag
  const level = score >= 0.75 ? 'high' : score >= 0.50 ? 'medium' : 'low';
  const tag = level === 'high' ? '🔥' : level === 'medium' ? '📦' : '📄';

  return { score: Math.round(score * 100) / 100, level, tag, reasons };
}

/**
 * Format quality bar for Discord embed.
 * @param {number} score — 0-1
 * @returns {string} e.g., "📊 0.85 ████████░░"
 */
export function formatQualityBar(score) {
  const pct = Math.round(score * 10);
  const filled = '█'.repeat(pct);
  const empty = '░'.repeat(10 - pct);
  return `${filled}${empty} ${(score * 100).toFixed(0)}%`;
}

/**
 * Filter low-quality items from an array.
 * @param {Array} items — Items with .title, .url, .source
 * @param {number} [minScore=0.35] — Minimum quality score
 * @returns {Array} Filtered items with .quality attached
 */
export function filterQuality(items, minScore = 0.35) {
  return items
    .map(item => {
      const quality = scoreContent(item);
      return { ...item, quality };
    })
    .filter(item => item.quality.score >= minScore)
    .sort((a, b) => b.quality.score - a.quality.score);
}

// ── Helpers ──

function extractDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
