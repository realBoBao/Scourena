/**
 * scripts/algo_webhook.js — Daily Algorithm Problem từ LeetCode
 *
 * Flow:
 *   8:00 AM: node scripts/algo_webhook.js daily   → gửi bài mới
 *   23:59 PM: node scripts/algo_webhook.js answer → gửi đáp án nếu chưa !done
 *   !done: đánh dấu đã giải
 *
 * Cần: ALGO_WEBHOOK_URL trong .env
 */

import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';

const DB_PATH = './vectors.db';
const ALGO_WEBHOOK_URL = process.env.ALGO_WEBHOOK_URL || '';

// ── LeetCode GraphQL API ────────────────────────────────────────────────────

async function fetchLeetCodeProblem() {
  const query = `query {
    activeDailyCodingChallengeQuestion {
      date
      link
      question {
        questionId
        title
        titleSlug
        difficulty
        content
        topicTags { name slug }
        hints
      }
    }
  }`;

  const res = await fetch('https://leetcode.com/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  const data = await res.json();
  return data.data?.activeDailyCodingChallengeQuestion;
}

// ── Discord Webhook ─────────────────────────────────────────────────────────

async function sendWebhook(payload) {
  if (!ALGO_WEBHOOK_URL) {
    console.log('[AlgoBot] ALGO_WEBHOOK_URL not set');
    return false;
  }

  const res = await fetch(ALGO_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return res.ok;
}

// ── Daily: Gửi bài mới ─────────────────────────────────────────────────────

async function sendDailyProblem() {
  console.log('[AlgoBot] Fetching LeetCode problem...');

  const ql = await fetchLeetCodeProblem();
  if (!ql) {
    console.error('[AlgoBot] Failed to fetch LeetCode problem');
    return;
  }

  const q = ql.question;
  const title = q.title;
  const difficulty = q.difficulty;
  const tags = q.topicTags.map(t => t.name).join(', ');
  const content = q.content?.replace(/<[^>]+>/g, '').slice(0, 1000) || 'Xem đề bài tại link bên dưới.';
  const link = `https://leetcode.com${ql.link}`;

  // Lưu vào DB
  const db = new DatabaseSync(DB_PATH);
  db.exec(`CREATE TABLE IF NOT EXISTS algo_daily (key TEXT PRIMARY KEY, value TEXT, created_at TEXT)`);
  const today = new Date().toISOString().slice(0, 10);

  db.prepare('INSERT OR REPLACE INTO algo_daily VALUES (?, ?, ?)').run(
    'current_problem',
    JSON.stringify({ title, difficulty, tags, content, link, date: today }),
    new Date().toISOString()
  );
  db.close();

  // Gửi webhook
  const payload = {
    embeds: [{
      color: difficulty === 'Easy' ? 0x22c55e : difficulty === 'Medium' ? 0xf59e0b : 0xff0000,
      title: `🧠 Daily Algorithm — ${title}`,
      description: `**Difficulty:** ${difficulty}\n**Tags:** ${tags}\n\n${content.slice(0, 500)}\n\n[📝 Giải bài này](${link})`,
      footer: { text: 'Gõ !done khi đã giải xong. Đáp án sẽ gửi lúc 23:59 nếu chưa giải.' },
      timestamp: new Date().toISOString(),
    }],
  };

  const ok = await sendWebhook(payload);
  console.log(`[AlgoBot] Sent daily problem: ${title} (${difficulty}) — ${ok ? 'OK' : 'FAILED'}`);
}

// ── Answer: Gửi đáp án 23:59 ────────────────────────────────────────────────

async function sendAnswer() {
  console.log('[AlgoBot] Checking if answer needed...');

  const db = new DatabaseSync(DB_PATH);
  const problemRow = db.prepare("SELECT value FROM algo_daily WHERE key = 'current_problem'").get();
  const solvedRow = db.prepare("SELECT value FROM algo_daily WHERE key = 'solved'").get();

  if (!problemRow) {
    console.log('[AlgoBot] No current problem.');
    db.close();
    return;
  }

  const problem = JSON.parse(problemRow.value);
  const today = new Date().toISOString().slice(0, 10);

  // Nếu đã giải hôm nay → skip
  if (solvedRow?.value === today) {
    console.log('[AlgoBot] Already solved today, skipping answer.');
    db.close();
    return;
  }

  db.close();

  // Gửi đáp án
  const payload = {
    embeds: [{
      color: 0x22c55e,
      title: `💡 Đáp án: ${problem.title}`,
      description: `**Difficulty:** ${problem.difficulty}\n**Tags:** ${problem.tags}\n\n${problem.content?.slice(0, 1000) || 'Xem solution tại LeetCode.'}\n\n[📝 Xem solution](${problem.link})`,
      footer: { text: 'Hôm nay lại có bài mới lúc 8AM!' },
      timestamp: new Date().toISOString(),
    }],
  };

  const ok = await sendWebhook(payload);
  console.log(`[AlgoBot] Sent answer for: ${problem.title} — ${ok ? 'OK' : 'FAILED'}`);
}

// ── Mark solved ─────────────────────────────────────────────────────────────

async function markSolved() {
  const db = new DatabaseSync(DB_PATH);
  db.exec(`CREATE TABLE IF NOT EXISTS algo_daily (key TEXT PRIMARY KEY, value TEXT, created_at TEXT)`);
  const today = new Date().toISOString().slice(0, 10);
  db.prepare('INSERT OR REPLACE INTO algo_daily VALUES (?, ?, ?)').run('solved', today, new Date().toISOString());
  db.close();
  console.log('[AlgoBot] Marked as solved for today.');
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const mode = process.argv[2] || 'daily';

switch (mode) {
  case 'daily':
    await sendDailyProblem();
    break;
  case 'answer':
    await sendAnswer();
    break;
  case 'done':
    await markSolved();
    break;
  default:
    console.log('Usage: node scripts/algo_webhook.js [daily|answer|done]');
}
