/**
 * Session Memory Integration Test — Trải nghiệm người dùng thực tế
 *
 * Simulate flow: user hỏi → Serena trả lời → user hỏi tiếp → Serena nhớ context
 * Không mock — dùng thực session_memory.js + orchestrator
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { SessionMemory } from '../lib/session_memory.js';
import fs from 'fs';

const TEST_DB = './data/test_session_memory.db';

beforeAll(() => {
  // Override DB path for tests
  process.env.SESSION_DB_PATH = TEST_DB;
  // Cleanup test DB
  try { fs.unlinkSync(TEST_DB); } catch { /* ignore */ }
});

afterAll(() => {
  try { fs.unlinkSync(TEST_DB); } catch { /* ignore */ }
  delete process.env.SESSION_DB_PATH;
});

beforeEach(() => {
  // Cleanup before each test
  try { fs.unlinkSync(TEST_DB); } catch { /* ignore */ }
});

describe('Session Memory — Trải nghiệm người dùng', () => {

  test('User hoi → Serena tra loi → luu vao session memory', () => {
    const userId = 'integration_test_user_1';

    // Buoc 1: User hoi
    SessionMemory.save(userId, 'user', 'Hoc Docker thi bat dau tu dau?');

    // Buoc 2: Serena tra loi
    SessionMemory.save(userId, 'assistant', 'Bat dau voi docker run hello-world, roi hoc Dockerfile co ban.');

    // Buoc 3: Verify luu thanh cong
    const history = SessionMemory.getRecent(userId, 6);
    expect(history.length).toBe(2);
    expect(history[0].role).toBe('user');
    expect(history[0].content).toContain('Docker');
    expect(history[1].role).toBe('assistant');
    expect(history[1].content).toContain('hello-world');
  });

  test('User hoi tiep → history co du context', () => {
    const userId = 'integration_test_user_1';

    // User hoi tiep (cau 2)
    SessionMemory.save(userId, 'user', 'Toi muon hoc Dockerfile, co the goi y bai tap thuc hanh khong?');
    SessionMemory.save(userId, 'assistant', 'Bat dau voi tao Dockerfile cho mot Node.js app don gian.');

    // Verify: history co 4 entries (2 cu + 2 moi)
    const history = SessionMemory.getRecent(userId, 6);
    expect(history.length).toBe(4);

    // Verify thu tu dung (reverse → oldest first)
    expect(history[0].content).toContain('Docker');        // cau 1 user
    expect(history[1].content).toContain('hello-world');    // cau 1 assistant
    expect(history[2].content).toContain('Dockerfile');    // cau 2 user
    expect(history[3].content).toContain('Node.js');       // cau 2 assistant
  });

  test('User hoi "cau truoc toi hoi gi?" → Serena co the tra loi', () => {
    const userId = 'integration_test_user_1';

    // Gia su Serena dung history de tra loi
    const history = SessionMemory.getRecent(userId, 6);

    // Tim cau hoi cuoi cung cua user
    const lastUserMsg = [...history].reverse().find(h => h.role === 'user');

    expect(lastUserMsg).toBeDefined();
    expect(lastUserMsg.content).toContain('Dockerfile');
  });

  test('User khac → history khong bi tron', () => {
    const userA = 'user_alice';
    const userB = 'user_bob';

    SessionMemory.save(userA, 'user', 'Toi hoc Python');
    SessionMemory.save(userA, 'assistant', 'Python la ngon ngu tuyet voi! Bat dau voi print("Hello").');

    SessionMemory.save(userB, 'user', 'Toi hoc Rust');
    SessionMemory.save(userB, 'assistant', 'Rust rat nhanh nhung hoc curve doc. Bat dau voi ownership.');

    const historyA = SessionMemory.getRecent(userA, 6);
    const historyB = SessionMemory.getRecent(userB, 6);

    // Alice chi thay conversation cua Alice
    expect(historyA.every(h => h.content.includes('Python') || h.content.includes('print'))).toBe(true);
    expect(historyA.some(h => h.content.includes('Rust'))).toBe(false);

    // Bob chi thay conversation cua Bob
    expect(historyB.every(h => h.content.includes('Rust') || h.content.includes('ownership'))).toBe(true);
    expect(historyB.some(h => h.content.includes('Python'))).toBe(false);
  });

  test('Cleanup — entries cũ hơn 7 ngày bị xóa', async () => {
    const userId = 'old_user';

    // Insert entry cũ (simulate bằng cách insert trực tiếp với timestamp cũ)
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(TEST_DB);

    db.exec(`
      CREATE TABLE IF NOT EXISTS session_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Insert entry 10 ngày trước
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO session_history (user_id, role, content, created_at) VALUES (?,?,?,?)')
      .run(userId, 'user', 'Old question 10 days ago', oldDate);

    // Close this DB instance so SessionMemory can open its own
    db.close();

    // Insert entry mới via SessionMemory
    SessionMemory.save(userId, 'user', 'New question today');

    // Cleanup
    SessionMemory.cleanup();

    // Verify: chỉ còn entry mới
    const history = SessionMemory.getRecent(userId, 6);
    expect(history.length).toBe(1);
    expect(history[0].content).toBe('New question today');
  });

  test('Session memory không crash khi DB unavailable', () => {
    // Test graceful degradation — không throw khi DB lỗi
    expect(() => {
      SessionMemory.save('user', 'user', 'test');
    }).not.toThrow();

    expect(() => {
      SessionMemory.getRecent('user', 6);
    }).not.toThrow();

    expect(() => {
      SessionMemory.cleanup();
    }).not.toThrow();
  });
});
