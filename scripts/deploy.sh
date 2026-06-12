#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Deploy script — Run this on GCP server
# Usage: bash scripts/deploy.sh
# ═══════════════════════════════════════════════════════════════

set -e

echo "=== Starting deployment at $(date) ==="
cd ~/ai-brain || { echo "❌ Project dir not found"; exit 1; }
echo "📁 Working dir: $(pwd)"

echo "📥 Pulling latest code..."
# Stash local changes before pull
git stash --include-untracked 2>/dev/null || true
git pull https://github.com/realBoBao/Serena_Project00_Auto-Teaching.git main

echo "📦 Installing dependencies..."
# Remove old lock file and node_modules to avoid version conflicts
rm -f package-lock.json
rm -rf node_modules
# Fresh install with legacy peer deps (Node 20 compatible)
npm install --legacy-peer-deps --only-production 2>&1 | tail -10
echo "📦 Installed $(ls node_modules | wc -l | awk '{print $1}') packages"

echo "🔄 Restarting PM2..."
pm2 restart all 2>/dev/null || pm2 start ecosystem.config.cjs
pm2 save

echo "✅ Deployment complete at $(date)"
echo "📊 PM2 Status:"
pm2 list
