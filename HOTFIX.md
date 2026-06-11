# 🔥 HOTFIX — Production Server Issues

## 0. CI/CD Deploy — Git Pull Failed

**Error:** `fatal: could not read Username/Password for 'https://github.com'`

**Nguyên nhân:** Git pull không có credential. SSH key không work, và `GITHUB_TOKEN` không có trong deploy context.

**Fix — Tạo PAT (Personal Access Token):**

1. Trên GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Tạo token mới với quyền `repo`
3. Vào repo `Serena_Project00_Auto-Teaching` → Settings → Secrets → Actions
4. Thêm secret mới: `DEPLOY_TOKEN` = giátrị PAT

**Hoặc dùng cách đơn giản hơn — git pull không cần auth nếu repo public:**
```bash
# Trên server, chạy 1 lần:
cd ~/ai-brain
git remote set-url origin https://github.com/realBoBao/Serena_Project00_Auto-Teaching.git
# Nếu repo private, cần PAT như trên
```

**Secrets cần có trong GitHub Actions:**
- `GCP_HOST` — IP/domain của VPS
- `GCP_USERNAME` — username SSH
- `GCP_SSH_KEY` — private key SSH
- `DEPLOY_TOKEN` — GitHub PAT (cho git pull HTTPS)
- `DISCORD_WEBHOOK` — Discord webhook URL (cho notifications)

## 1. `Pipeline error: score is not defined`

**Nguyên nhân:** Trong `pipeline_report_v2.js`, hàm `calculateSourceScore()` trả về giá trị 0-1, nhưng code so sánh `r.score >= 6` (giả định thang 0-10).

**Fix đã áp dụng:** Đổi threshold từ `6/4` → `0.7/0.4`.

**Trên production server, chạy:**
```bash
cd /home/bogiabao2006/ai-brain
grep -n "score >= 6" pipeline_report_v2.js
# Nếu có, sửa thành:
# const goodRepos = repos.filter(r => r.score >= 0.7);
# const okRepos = repos.filter(r => r.score >= 0.4 && r.score < 0.7);
# const weakRepos = repos.filter(r => r.score < 0.4);
```

## 2. `Backup failed: Unexpected end of input`

**Nguyên nhân:** File `catch-up.json` hoặc backup metadata bị corrupt (empty hoặc truncated).

**Fix:** Thêm defensive JSON.parse vào tất cả đọc file:

```javascript
// Trong scheduler.js — thay thế mọi JSON.parse(file) bằng:
function safeReadJson(filePath, defaultValue = {}) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw || raw.trim() === '') return defaultValue;
    return JSON.parse(raw);
  } catch {
    console.warn(`[scheduler] Corrupt JSON file: ${filePath}, using defaults`);
    return defaultValue;
  }
}
```

**Trên production server:**
```bash
# Kiểm tra file corrupt
cat /home/bogiabao2006/ai-brain/catch-up.json
# Nếu empty hoặc truncated:
echo '{}' > /home/bogiabao2006/ai-brain/catch-up.json
```

## 3. Các lỗi KHÔNG CẦN SỬA (expected behavior)

| Lý do | Fallback |
|---|---|
| `Qdrant not available` | ✅ Tự fallback SQLite |
| `Reddit 403` | ✅ Trả về empty results |
| `LLM API error` | ✅ Fallback heuristic |
| `Gemini 503` | ✅ Tự retry |
| `Discord shard reconnecting` | ✅ Auto-reconnect |
