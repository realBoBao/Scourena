/**
 * PM2 Ecosystem — AI Brain v7 (Simplified)
 *
 * Chỉ chạy AI_Brain (gateway.js) — gateway tự quản lý 4 services bên trong.
 * KHÔNG spawn scheduler riêng — tránh trùng lặp.
 *
 * ⚠️ SECURITY: All API keys are loaded from .env file via dotenv.
 *    NEVER hardcode keys in this file.
 */
module.exports = {
  apps: [
    {
      name: "AI_Brain",
      script: "./gateway.js",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      max_memory_restart: "600M",
      node_args: "--max-old-space-size=512",
      env: {
        NODE_ENV: "production",
        DISCORD_COMMAND_PREFIX: "!ask ",
        REST_API_PORT: "3005",
        FEEDBACK_PORT: "4002",
        REDIS_HOST: "127.0.0.1",
        REDIS_PORT: "6379",
        ...(process.env.GOOGLE_API_KEY ? { GOOGLE_API_KEY: process.env.GOOGLE_API_KEY } : {}),
        ...(process.env.GEMINI_API_KEY ? { GEMINI_API_KEY: process.env.GEMINI_API_KEY } : {}),
      },
    },
  ],
};
