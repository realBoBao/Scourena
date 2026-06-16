/**
 * lib/repo_analyzer.js — Repository analysis utilities
 * Analyzes code repos, READMEs, file contents for knowledge extraction.
 * @module lib/repo_analyzer
 */

import { getLogger } from './logger.js';
import fs from 'fs';
import path from 'path';
const logger = getLogger('RepoAnalyzer');

/**
 * Analyze a README file.
 */
export async function analyzeReadme(readmePath) {
  try {
    const content = fs.readFileSync(readmePath, 'utf8');
    return {
      path: readmeName,
      title: content.match(/^#\s+(.+)/m)?.[1] || '',
      description: content.match(/^#\s+.+\n\n(.+)/s)?.[1]?.slice(0, 300) || '',
      sections: content.match(/^#{1,3}\s+.+/gm)?.map(s => s.replace(/^#+\s+/, '')) || [],
      length: content.length,
    };
  } catch (err) {
    logger.debug('[RepoAnalyzer] analyzeReadme failed:', err.message);
    return null;
  }
}

/**
 * Fetch file content from a path.
 */
export async function fetchFileContent(owner, repo, fileName, token) {
  try {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/main/${fileName}`;
    const headers = token ? { Authorization: `token ${token}` } : {};
    const res = await globalThis.fetch(url, { headers });
    if (!res.ok) {
      // Try master branch fallback
      const url2 = `https://raw.githubusercontent.com/${owner}/${repo}/master/${fileName}`;
      const res2 = await globalThis.fetch(url2, { headers });
      if (!res2.ok) return null;
      return await res2.text();
    }
    return await res.text();
  } catch (err) {
    logger.debug('[RepoAnalyzer] fetchFileContent failed:', err.message);
    return null;
  }
}

/**
 * Analyze text content (extract key topics, summary).
 * @param {string} text - Text to analyze
 * @param {string} [type='text'] - Content type (readme, arxiv, web, etc.)
 * @param {object} [metadata={}] - Optional metadata (owner, repo, source, etc.)
 * @returns {{ summary: string[], topics: string[], length: number, category?: string }}
 */
export async function analyzeText(text, type = 'text', metadata = {}) {
  if (!text || typeof text !== 'string') return { summary: [], topics: [], length: 0 };
  const maxLen = 2000;
  const truncated = text.slice(0, maxLen);
  const sentences = truncated.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const topics = [];
  const topicPatterns = /(?:^|\n)#+\s+(.+)|(?:topic|subject|about|về)\s*:\s*(.+)/gi;
  let match;
  while ((match = topicPatterns.exec(truncated)) !== null) {
    topics.push((match[1] || match[2]).trim());
  }
  // Simple category detection based on content
  const lower = truncated.toLowerCase();
  let category = 'Backend';
  if (/\b(machine learning|neural|deep learning|llm|transformer|ai model)\b/.test(lower)) category = 'AI';
  else if (/\b(docker|kubernetes|deploy|ci\/cd|infrastructure|terraform|devops)\b/.test(lower)) category = 'DevOps';
  else if (/\b(algorithm|data structure|complexity|sorting|graph|tree|dynamic programming)\b/.test(lower)) category = 'Algorithms';
  else if (/\b(calculus|linear algebra|statistics|probability|theorem|proof|equation)\b/.test(lower)) category = 'Math';
  return {
    summary: sentences.slice(0, 3).map(s => s.trim().slice(0, 500)),
    topics: topics.slice(0, 10),
    length: text.length,
    category,
    length: text.length,
  };
}

export default { analyzeReadme, fetchFileContent, analyzeText };
