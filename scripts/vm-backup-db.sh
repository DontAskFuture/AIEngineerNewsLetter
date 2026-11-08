#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${1:-$(cd "$SCRIPT_DIR/.." && pwd)}"
ENV_FILE="$REPO_DIR/.env"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"

if [ -d "/var/oled" ]; then
  BACKUP_DIR="${BACKUP_DIR:-/var/oled/backups}"
else
  BACKUP_DIR="${BACKUP_DIR:-$REPO_DIR/var/backups}"
fi

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

send_failure_email() {
  local error_msg="$1"
  local smtp_host smtp_port smtp_user smtp_pass smtp_from admin_email
  smtp_host="$(read_env SMTP_HOST "smtp.gmail.com")"
  smtp_port="$(read_env SMTP_PORT "587")"
  smtp_user="$(read_env SMTP_USER "")"
  smtp_pass="$(read_env SMTP_PASSWORD "")"
  smtp_from="$(read_env SMTP_FROM_EMAIL "$smtp_user")"
  admin_email="$(read_env ADMIN_EMAILS "$smtp_user" | cut -d, -f1)"

  if [ -z "$smtp_user" ] || [ -z "$smtp_pass" ] || [ -z "$admin_email" ]; then
    return 0
  fi

  curl -fsS --max-time 15 --ssl-reqd \
    --url "smtp://${smtp_host}:${smtp_port}" \
    --user "${smtp_user}:${smtp_pass}" \
    --mail-from "$smtp_from" \
    --mail-rcpt "$admin_email" \
    -T - <<MAIL || true
From: AI Newsletter Backup <${smtp_from}>
To: <${admin_email}>
Subject: [AI Newsletter VM] Daily Postgres backup FAILED
Date: $(date -R)
Content-Type: text/plain; charset=UTF-8

Daily Postgres backup on $(hostname) failed at $(date -u +"%Y-%m-%dT%H:%M:%SZ"):

${error_msg}
MAIL
}

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y-%m-%d)"
TARGET_FILE="$BACKUP_DIR/ai_intel-${STAMP}.dump"
TMP_FILE="${TARGET_FILE}.tmp"

cd "$REPO_DIR"
echo "[backup] Dumping Postgres database to $TARGET_FILE..."

if ! docker compose --profile tunnel exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$TMP_FILE" 2>/tmp/pg_dump.err; then
  err_output="$(cat /tmp/pg_dump.err 2>/dev/null || echo "pg_dump exited non-zero")"
  rm -f "$TMP_FILE"
  echo "[backup] ERROR: $err_output" >&2
  send_failure_email "$err_output"
  exit 1
fi

if [ ! -s "$TMP_FILE" ]; then
  rm -f "$TMP_FILE"
  send_failure_email "pg_dump produced an empty archive file ($TARGET_FILE)."
  exit 1
fi

mv "$TMP_FILE" "$TARGET_FILE"
chmod 600 "$TARGET_FILE"

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'ai_intel-*.dump' -mtime +"$RETENTION_DAYS" -delete
ls -lh "$TARGET_FILE"
echo "[backup] Completed successfully (retention: ${RETENTION_DAYS} days)."
