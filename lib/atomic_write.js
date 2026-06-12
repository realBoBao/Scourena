/**
 * Atomic Write Utility — Prevents corrupt JSON files from partial writes
 *
 * Pattern: write to temp file → rename (atomic on most filesystems)
 * Also handles safe read with JSON validation and backup recovery.
 *
 * @module lib/atomic_write
 */

import { writeFile, readFile, rename, unlink, access } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

/**
 * Atomically write JSON data to a file.
 * Writes to a temp file first, then renames (atomic operation).
 * Keeps one .bak backup for recovery.
 */
export async function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  const tmpPath = `${filePath}.tmp`;
  const bakPath = `${filePath}.bak`;

  try {
    // Serialize with pretty print for debuggability
    const json = JSON.stringify(data, null, 2);

    // Write to temp file
    await writeFile(tmpPath, json, 'utf8');

    // Backup existing file if it exists
    try {
      if (existsSync(filePath)) {
        // Copy current to backup (non-critical, ignore errors)
        const current = await readFile(filePath, 'utf8').catch(() => null);
        if (current) {
          await writeFile(bakPath, current, 'utf8').catch(() => {});
        }
      }
    } catch { /* backup is best-effort */ }

    // Atomic rename (on Windows, may need to remove target first)
    try {
      await rename(tmpPath, filePath);
    } catch {
      // Windows: rename fails if target exists — remove then rename
      try { await unlink(filePath); } catch { /* ignore */ }
      await rename(tmpPath, filePath);
    }
  } catch (err) {
    // Clean up temp file on failure
    try { await unlink(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Safely read JSON from a file with validation.
 * If main file is corrupt, tries .bak backup.
 * Returns defaultValue if both fail.
 */
export async function readJsonSafe(filePath, defaultValue = {}) {
  // Try main file first
  try {
    if (existsSync(filePath)) {
      const raw = await readFile(filePath, 'utf8');
      if (!raw.trim()) return defaultValue; // Empty file
      return JSON.parse(raw);
    }
  } catch {
    // Main file corrupt — try backup
    try {
      const bakPath = `${filePath}.bak`;
      if (existsSync(bakPath)) {
        const raw = await readFile(bakPath, 'utf8');
        if (!raw.trim()) return defaultValue;
        const data = JSON.parse(raw);
        // Restore from backup
        await writeFile(filePath, raw, 'utf8').catch(() => {});
        return data;
      }
    } catch { /* backup also corrupt */ }
  }
  return defaultValue;
}

export default { writeJsonAtomic, readJsonSafe };
