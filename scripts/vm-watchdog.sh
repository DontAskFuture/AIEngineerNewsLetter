#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${1:-$(cd "$SCRIPT_DIR/.." && pwd)}"
ENV_FILE="$REPO_DIR/.env"
LOCAL_URL="http://127.0.0.1:3000/api/health"
COOLDOWN_FILE="/tmp/watchdog-last-email"
COOLDOWN_SECONDS=1800

read_env() {
  local key="$1"
  local default_val="${2:-}"
  if [ -f "$ENV_FILE" ]; then
    local val
    val=$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d "\r\"'" || true)
    if [ -n "$val" ]; then
      printf '%s' "$val"
      return 0
    fi
  fi
  printf '%s' "$default_val"
}

APP_BASE_URL="$(read_env APP_BASE_URL "https://ai-newsletter.auditvolt.stream")"
PUBLIC_URL="${APP_BASE_URL%/}/api/health"

send_alert_email() {
  local subject="$1"
  local body="$2"

  if [ ! -f "$ENV_FILE" ]; then
    return 0
  fi

  if [ -f "$COOLDOWN_FILE" ]; then
    local last_sent now
    last_sent=$(cat "$COOLDOWN_FILE" 2>/dev/null || echo 0)
    now=$(date +%s)
    if [ $((now - last_sent)) -lt "$COOLDOWN_SECONDS" ]; then
      echo "[watchdog] Skipping email alert (within 30m cooldown)"
      return 0
    fi
  fi

  local smtp_host smtp_port smtp_user smtp_pass smtp_from admin_email
  smtp_host="$(read_env SMTP_HOST "smtp.gmail.com")"
  smtp_port="$(read_env SMTP_PORT "587")"
  smtp_user="$(read_env SMTP_USER "")"
  smtp_pass="$(read_env SMTP_PASSWORD "")"
  smtp_from="$(read_env SMTP_FROM_EMAIL "$smtp_user")"
  admin_email="$(read_env ADMIN_EMAILS "$smtp_user" | cut -d, -f1)"

  if [ -z "$smtp_user" ] || [ -z "$smtp_pass" ] || [ -z "$admin_email" ]; then
    echo "[watchdog] SMTP credentials not configured; skipping email alert"
    return 0
  fi

  curl -fsS --max-time 15 --ssl-reqd \
    --url "smtp://${smtp_host}:${smtp_port}" \
    --user "${smtp_user}:${smtp_pass}" \
    --mail-from "$smtp_from" \
    --mail-rcpt "$admin_email" \
    -T - <<MAIL || echo "[watchdog] Failed to send alert email"
From: AI Newsletter Watchdog <${smtp_from}>
To: <${admin_email}>
Subject: ${subject}
Date: $(date -R)
Content-Type: text/plain; charset=UTF-8

${body}
MAIL

  date +%s > "$COOLDOWN_FILE"
}

cd "$REPO_DIR"
issues=()
actions=()

# 1. Check Postgres & Worker containers
pg_health=$(docker inspect -f "{{.State.Health.Status}}" ai-intel-postgres 2>/dev/null || echo "missing")
worker_running=$(docker inspect -f "{{.State.Running}}" aiengineernewsletter-worker-1 2>/dev/null || echo "false")

if [ "$pg_health" != "healthy" ]; then
  issues+=("postgres status is $pg_health")
fi
if [ "$worker_running" != "true" ]; then
  issues+=("worker running=$worker_running")
fi

# 2. Check local web + DB health
local_ok=true
if ! curl -fsS --max-time 5 "$LOCAL_URL" >/dev/null 2>&1; then
  sleep 3
  if ! curl -fsS --max-time 5 "$LOCAL_URL" >/dev/null 2>&1; then
    local_ok=false
    issues+=("local web health check ($LOCAL_URL) failed")
  fi
fi

# 3. Check public Cloudflare Tunnel URL
public_ok=true
if ! curl -fsS --max-time 10 "$PUBLIC_URL" >/dev/null 2>&1; then
  sleep 5
  if ! curl -fsS --max-time 10 "$PUBLIC_URL" >/dev/null 2>&1; then
    public_ok=false
    issues+=("public tunnel health check ($PUBLIC_URL) failed")
  fi
fi

# 4. Auto-heal containers if anything is unhealthy
if [ "$pg_health" != "healthy" ] || [ "$worker_running" != "true" ] || [ "$local_ok" = "false" ]; then
  echo "[watchdog] Unhealthy core service detected (${issues[*]}); restarting stack..."
  docker compose --profile tunnel up -d
  if [ "$local_ok" = "false" ]; then
    docker compose --profile tunnel restart web cloudflared
  fi
  actions+=("Ran docker compose --profile tunnel up -d / restart web cloudflared")
elif [ "$public_ok" = "false" ]; then
  echo "[watchdog] Public tunnel down while local web is healthy; restarting cloudflared..."
  docker compose --profile tunnel restart cloudflared
  actions+=("Restarted cloudflared container")
fi

# 5. Check disk usage (>85% on /)
disk_pct=$(df --output=pcent / | tail -1 | tr -dc "0-9")
if [ "$disk_pct" -ge 85 ]; then
  issues+=("root disk usage is ${disk_pct}%")
  docker builder prune -af >/dev/null 2>&1 || true
  actions+=("Pruned Docker build cache")
fi

# 6. Send email if any issue occurred
if [ "${#issues[@]}" -gt 0 ]; then
  sleep 5
  post_status=$(docker compose --profile tunnel ps 2>&1 || true)
  post_public="DOWN"
  if curl -fsS --max-time 10 "$PUBLIC_URL" >/dev/null 2>&1; then
    post_public="UP (200 OK)"
  fi

  body="Oracle VM Watchdog ($(hostname)) detected an issue and ran auto-recovery:

Issues detected:
$(printf "  - %s\n" "${issues[@]}")

Actions taken:
$(printf "  - %s\n" "${actions[@]:-none}")

Public endpoint ($PUBLIC_URL) after recovery: $post_public
Root disk usage: ${disk_pct}%

Current containers:
$post_status"

  send_alert_email "[AI Newsletter VM] Auto-recovery triggered (${issues[0]})" "$body"
fi
