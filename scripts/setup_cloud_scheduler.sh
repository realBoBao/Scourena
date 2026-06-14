#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Setup Google Cloud Scheduler jobs cho AI Brain
# ═══════════════════════════════════════════════════════════════
# Chạy 1 lần để tạo tất cả scheduler jobs.
# Yêu cầu: gcloud CLI đã authenticate + project đã set.
#
# Usage:
#   chmod +x scripts/setup_cloud_scheduler.sh
#   ./scripts/setup_cloud_scheduler.sh https://your-cloud-run-url.a.run.app
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-gen-lang-client-0524859745}"
REGION="${CLOUD_RUN_REGION:-us-central1}"
TIMEZONE="America/Los_Angeles"

# Cloud Run URL (pass as argument or set env var)
CLOUD_RUN_URL="${1:-${CLOUD_RUN_URL:-}}"
if [ -z "$CLOUD_RUN_URL" ]; then
  echo "❌ Usage: $0 <cloud-run-url>"
  echo "   Example: $0 https://my-ai-brain-api-xxx-uc.a.run.app"
  exit 1
fi

# Service account for OIDC authentication
SA_EMAIL="${SCHEDULER_SA_EMAIL:-}"

echo "═══════════════════════════════════════════════════════════════"
echo "  Cloud Scheduler Setup — AI Brain"
echo "═══════════════════════════════════════════════════════════════"
echo "  Project:    $PROJECT_ID"
echo "  Region:     $REGION"
echo "  Timezone:   $TIMEZONE"
echo "  Cloud Run:  $CLOUD_RUN_URL"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ── Helper: create or update a scheduler job ─────────────────────────────────
create_job() {
  local name="$1"
  local schedule="$2"
  local uri_path="$3"
  local description="${4:-}"
  local body="${5:-}"

  local full_uri="${CLOUD_RUN_URL}${uri_path}"

  echo "📋 Creating job: $name"
  echo "   Schedule: $schedule ($TIMEZONE)"
  echo "   URI:      $full_uri"

  # Build command
  local cmd="gcloud scheduler jobs create http ${name}"
  cmd="$cmd --project=$PROJECT_ID"
  cmd="$cmd --location=$REGION"
  cmd="$cmd --schedule='$schedule'"
  cmd="$cmd --uri=$full_uri"
  cmd="$cmd --http-method=POST"
  cmd="$cmd --time-zone=$TIMEZONE"
  cmd="$cmd --headers=Content-Type=application/json"

  if [ -n "$description" ]; then
    cmd="$cmd --description='$description'"
  fi

  if [ -n "$body" ]; then
    cmd="$cmd --message-body='$body'"
  fi

  if [ -n "$SA_EMAIL" ]; then
    cmd="$cmd --oidc-service-account-email=$SA_EMAIL"
    cmd="$cmd --oidc-token-audience=$CLOUD_RUN_URL"
  fi

  # Execute (ignore error if job already exists — update instead)
  if eval "$cmd" 2>/dev/null; then
    echo "   ✅ Created"
  else
    echo "   ⚠️  Job exists, updating..."
    # Remove 'create' and use 'update'
    local update_cmd="${cmd/create/update}"
    eval "$update_cmd" && echo "   ✅ Updated" || echo "   ❌ Failed"
  fi
  echo ""
}

# ═══════════════════════════════════════════════════════════════
#  DAILY JOBS (theo giờ PDT — Pacific Daylight Time)
# ═══════════════════════════════════════════════════════════════

# ── 8:00 AM PDT — Morning pipeline + memory consolidation ──
create_job "ai-brain-morning" \
  "0 8 * * *" \
  "/scheduler/pipeline" \
  "Morning pipeline run (8AM PDT)" \
  '{"source":"cloud-scheduler","job":"pipeline","time":"morning"}'

# ── 11:00 AM PDT ──
create_job "ai-brain-midday" \
  "0 11 * * *" \
  "/scheduler/pipeline" \
  "Midday pipeline run (11AM PDT)" \
  '{"source":"cloud-scheduler","job":"pipeline","time":"midday"}'

# ── 2:00 PM PDT ──
create_job "ai-brain-afternoon" \
  "0 14 * * *" \
  "/scheduler/pipeline" \
  "Afternoon pipeline run (2PM PDT)" \
  '{"source":"cloud-scheduler","job":"pipeline","time":"afternoon"}'

# ── 5:00 PM PDT ──
create_job "ai-brain-evening" \
  "0 17 * * *" \
  "/scheduler/pipeline" \
  "Evening pipeline run (5PM PDT)" \
  '{"source":"cloud-scheduler","job":"pipeline","time":"evening"}'

# ── 8:00 PM PDT ──
create_job "ai-brain-night" \
  "0 20 * * *" \
  "/scheduler/pipeline" \
  "Night pipeline run (8PM PDT)" \
  '{"source":"cloud-scheduler","job":"pipeline","time":"night"}'

# ═══════════════════════════════════════════════════════════════
#  WEEKLY JOBS
# ═══════════════════════════════════════════════════════════════

# ── Monday 4:00 AM PDT — Evolution evaluation ──
create_job "ai-brain-evolution" \
  "0 4 * * 1" \
  "/scheduler/evolution" \
  "Weekly evolution evaluation (Monday 4AM PDT)" \
  '{"source":"cloud-scheduler","job":"evolution"}'

# ── Sunday 3:00 AM PDT ──
create_job "ai-brain-backup" \
  "0 3 * * 0" \
  "/scheduler/backup" \
  "Weekly backup (Sunday 3AM PDT)" \
  '{"source":"cloud-scheduler","job":"backup"}'

# ═══════════════════════════════════════════════════════════════
#  GRAPH SYNC (daily at 1:00 AM PDT)
# ═══════════════════════════════════════════════════════════════
create_job "ai-brain-graph-sync" \
  "0 1 * * *" \
  "/scheduler/graph" \
  "Daily knowledge graph sync (1AM PDT)" \
  '{"source":"cloud-scheduler","job":"graph"}'

echo "═══════════════════════════════════════════════════════════════"
echo "  ✅ All scheduler jobs created!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Verify with: gcloud scheduler jobs list --location=$REGION"
echo "  Test a job:  gcloud scheduler jobs run ai-brain-morning --location=$REGION"
echo ""
