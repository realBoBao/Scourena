#!/bin/bash
# Fix dependency issues on GCP server
# Run: bash scripts/fix_deps.sh

set -e

echo "=== Fixing dependencies ==="

# Remove corrupted lock file
rm -f package-lock.json

# Install with legacy-peer-deps to resolve conflicts
npm install --legacy-peer-deps

# Verify
echo "=== Verifying ==="
npm ci --ignore-scripts 2>&1 || echo "⚠️ npm ci failed but npm install OK"

echo "=== Done ==="
