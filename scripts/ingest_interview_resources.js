/**
 * scripts/ingest_interview_resources.js — Tier 1: Static RAG Ingestion
 *
 * Nạp nội dung từ các repo GitHub interview resources vào Vector DB.
 * Chạy 1 lần duy nhất, không cần maintain.
 *
 * Usage: node scripts/ingest_interview_resources.js
 */

import { DatabaseSync } from 'node:sqlite';
import { embedText } from '../lib/embeddings.js';
import { chunkText } from '../lib/chunking.js';

// ── Sources với difficulty & prerequisites ──────────────────────────────────
// Tier 1: Easy (Arrays, HashMaps, Two Pointers)
// Tier 2: Medium (Stack, Linked List, Sliding Window, Binary Search)
// Tier 3: Hard (Trees, Tries, Backtracking, Graphs)
// Tier 4: Expert (Dynamic Programming, Greedy, Union Find)
const SOURCES = [
  // ── Tier 1: Easy ──
  {
    repo: 'jwasham/coding-interview-university',
    path: 'README.md',
    domain: 'algorithms',
    difficulty: 'easy',
    tier: 1,
    tags: ['arrays', 'hashmap', 'two-pointers', 'strings'],
    prerequisites: [],
  },
  {
    repo: 'trekhleb/javascript-algorithms',
    path: 'README.md',
    domain: 'algorithms',
    difficulty: 'easy',
    tier: 1,
    tags: ['arrays', 'hashmap', 'strings', 'sorting'],
    prerequisites: [],
  },
  {
    repo: 'krahets/hello-algo',
    path: 'README.md',
    domain: 'algorithms',
    difficulty: 'easy',
    tier: 1,
    tags: ['arrays', 'hashmap', 'binary-search'],
    prerequisites: [],
  },

  // ── Tier 2: Medium ──
  {
    repo: 'yangshun/tech-interview-handbook',
    path: 'contents/coding-interview-techniques.md',
    domain: 'algorithms',
    difficulty: 'medium',
    tier: 2,
    tags: ['stack', 'queue', 'linked-list', 'sliding-window', 'binary-search'],
    prerequisites: ['arrays', 'hashmap'],
  },
  {
    repo: 'Gaurav14cs17/DSA',
    path: 'README.md',
    domain: 'algorithms',
    difficulty: 'medium',
    tier: 2,
    tags: ['stack', 'queue', 'linked-list', 'trees'],
    prerequisites: ['arrays', 'hashmap'],
  },
  {
    repo: 'amejiarosario/dsa.js-data-structures-and-algorithms-javascript',
    path: 'README.md',
    domain: 'algorithms',
    difficulty: 'medium',
    tier: 2,
    tags: ['stack', 'queue', 'linked-list', 'sorting'],
    prerequisites: ['arrays', 'hashmap'],
  },

  // ── Tier 3: Hard ──
  {
    repo: 'dipjul/Grokking-the-Coding-Interview-Patterns-for-Coding-Questions',
    path: 'README.md',
    domain: 'algorithms',
    difficulty: 'hard',
    tier: 3,
    tags: ['trees', 'tries', 'backtracking', 'graphs'],
    prerequisites: ['stack', 'queue', 'linked-list'],
  },
  {
    repo: 'labuladong/fucking-algorithm',
    path: 'README.md',
    domain: 'algorithms',
    difficulty: 'hard',
    tier: 3,
    tags: ['trees', 'graphs', 'backtracking', 'dp-intro'],
    prerequisites: ['stack', 'queue', 'linked-list'],
  },
  {
    repo: 'ashishps1/awesome-leetcode-resources',
    path: 'README.md',
    domain: 'algorithms',
    difficulty: 'hard',
    tier: 3,
    tags: ['trees', 'graphs', 'dp', 'backtracking'],
    prerequisites: ['stack', 'queue', 'linked-list'],
  },

  // ── Tier 4: Expert ──
  {
    repo: 'DopplerHQ/awesome-interview-questions',
    path: 'README.md',
    domain: 'algorithms',
    difficulty: 'expert',
    tier: 4,
    tags: ['dp', 'greedy', 'union-find', 'advanced-graphs'],
    prerequisites: ['trees', 'graphs', 'backtracking'],
  },

  // ── Career ──
  {
    repo: 'SimplifyJobs/Summer2026-Internships',
    path: 'README.md',
    domain: 'career',
    difficulty: 'easy',
    tier: 0,
    tags: ['internships', 'jobs', 'career', 'summer-2026'],
    prerequisites: [],
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

async function fetchFromGitHub(repo, filePath) {
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${filePath}`;
  const res = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'my-ai-brain/1.0',
      'Accept': 'application/vnd.github.v3+json',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    // Fallback: thử raw URL
    const rawUrl = `https://raw.githubusercontent.com/${repo}/main/${filePath}`;
    const rawRes = await fetch(rawUrl, {
      headers: { 'User-Agent': 'my-ai-brain/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!rawRes.ok) throw new Error(`Fetch failed: ${res.status} / ${rawRes.status}`);
    return rawRes.text();
  }

  const data = await res.json();
  if (!data.content) throw new Error('No content in response');
  return Buffer.from(data.content, 'base64').toString('utf8');
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const db = new DatabaseSync('./vectors.db');

  // Ensure domain column exists
  try {
    db.exec("ALTER TABLE vectors ADD COLUMN domain TEXT DEFAULT 'general'");
  } catch { /* already exists */ }
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_vectors_domain ON vectors(domain)");
  } catch { /* already exists */ }

  // Xóa interview data cũ để insert fresh
  db.prepare("DELETE FROM vectors WHERE id LIKE 'interview::%'").run();
  db.prepare("DELETE FROM vectors WHERE domain = 'career'").run();
  console.log('Cleared old interview data');

  // Tạo bảng algo_daily nếu chưa có
  db.prepare(`
    CREATE TABLE IF NOT EXISTS algo_daily (
      key TEXT PRIMARY KEY,
      value TEXT,
      created_at TEXT
    )
  `).run();

  let totalIngested = 0;

  for (const source of SOURCES) {
    console.log(`\n[Ingest] ${source.repo}/${source.path} (${source.difficulty})...`);

    try {
      const content = await fetchFromGitHub(source.repo, source.path);
      const chunks = chunkText(content, 1500);

      console.log(`  Fetched ${content.length} chars → ${chunks.length} chunks`);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (chunk.length < 50) continue;

        let embedding;
        try {
          embedding = await embedText(chunk.slice(0, 1000));
        } catch {
          continue;
        }
        if (!embedding || embedding.length === 0) continue;

        const docId = `interview::${source.repo}::${i}`;
        const metadata = JSON.stringify({
          domain: source.domain,
          difficulty: source.difficulty,
          tier: source.tier,
          tags: source.tags,
          prerequisites: source.prerequisites,
          source: `https://github.com/${source.repo}`,
          source_path: source.path,
          chunk_index: i,
          indexed_at: new Date().toISOString(),
        });

        try {
          db.prepare(
            'INSERT INTO vectors (id, doc_id, chunk_index, chunk_text, embedding, domain, metadata, url, project, category, added_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(
            docId,
            `interview::${source.repo}`,
            i,
            chunk,
            Buffer.from(new Float32Array(embedding).buffer),
            source.domain,
            metadata,
            `https://github.com/${source.repo}`,
            source.repo,
            'Algorithms',
            new Date().toISOString(),
            new Date().toISOString()
          );
          totalIngested++;
        } catch (e) {
          // Skip duplicates (UNIQUE constraint on id)
          if (!e.message.includes('UNIQUE')) {
            console.warn(`  Insert failed for ${docId}: ${e.message}`);
          }
        }
      }

      console.log(`  ✓ Ingested ${chunks.length} chunks`);
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}`);
    }
  }

  // Verify
  const totalVectors = db.prepare('SELECT COUNT(*) as n FROM vectors').get().n;
  const dist = db.prepare('SELECT domain, difficulty, COUNT(*) as cnt FROM vectors GROUP BY domain, difficulty ORDER BY domain, difficulty').all();

  console.log(`\n=== Summary ===`);
  console.log(`Total ingested: ${totalIngested}`);
  console.log(`Total vectors in DB: ${totalVectors}`);
  console.log('Distribution:');
  for (const r of dist) console.log(`  ${r.domain}/${r.difficulty}: ${r.cnt}`);

  db.close();
  console.log('\n[Ingest] Done!');
}

main().catch(err => {
  console.error('[Ingest] Fatal:', err.message);
  process.exit(1);
});
