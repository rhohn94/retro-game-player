#!/usr/bin/env bash
# start-with-rom-sites.sh — enable curated ROM-site download providers, then launch RGP.
#
# What it does:
#   1. Opens the app's local SQLite DB (com.retro-game-player.app)
#   2. Sets enabled=1 and direct_download=1 on known ROM-site providers
#      (so Search shows them and in-row ⬇ Download works)
#   3. Starts the app (deployed bundle if present, else `pnpm tauri dev`)
#
# Usage:
#   ./scripts/start-with-rom-sites.sh            # enable + launch (auto mode)
#   ./scripts/start-with-rom-sites.sh --dev      # enable + pnpm tauri dev
#   ./scripts/start-with-rom-sites.sh --deployed # enable + open installed .app
#   ./scripts/start-with-rom-sites.sh --enable-only
#   ./scripts/start-with-rom-sites.sh --status
#   ./scripts/start-with-rom-sites.sh --dry-run
#
# Notes:
#   - Retro Game Player ships no game content. Enabling these providers only
#     turns on Search templates / optional direct-download for sources you
#     choose; legality of any source is your responsibility.
#   - Requires `sqlite3` on PATH.
#   - Safe to re-run (idempotent UPDATE).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="com.retro-game-player.app"
DB_PATH="${RGP_DB_PATH:-$HOME/Library/Application Support/${APP_ID}/harmony.db}"
DEPLOY_APP="${RGP_DEPLOY_APP:-$HOME/Projects/deployed-apps/harmony/current/Retro Game Player.app}"

# Seeded ROM sites (migration 005) plus common manual adds used in this install.
# Names must match search_providers.name exactly (case-sensitive).
ROM_SITE_NAMES=(
  "RomsGames"
  "Romspedia"
  "RomsFun"
  "WoWROMs"
  "CoolROM"
  "EmulatorGames"
  "ROMSPURE"
  "Retrostic"
  "Romspedia EU"
  "ROMsMania"
  "Romulation"
)

MODE="auto"       # auto | dev | deployed
ENABLE_ONLY=0
STATUS_ONLY=0
DRY_RUN=0

usage() {
  sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev) MODE="dev"; shift ;;
    --deployed) MODE="deployed"; shift ;;
    --enable-only) ENABLE_ONLY=1; shift ;;
    --status) STATUS_ONLY=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --db) DB_PATH="${2:?--db requires a path}"; shift 2 ;;
    -h|--help) usage 0 ;;
    *)
      echo "Unknown option: $1" >&2
      usage 1
      ;;
  esac
done

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: required command not found: $1" >&2
    exit 1
  }
}

need sqlite3

if [[ ! -f "$DB_PATH" ]]; then
  echo "error: app database not found:" >&2
  echo "  $DB_PATH" >&2
  echo >&2
  echo "Launch Retro Game Player once so it creates the DB, then re-run." >&2
  echo "Or set RGP_DB_PATH / pass --db PATH." >&2
  exit 1
fi

sql_quote_list() {
  local first=1 name
  printf "("
  for name in "$@"; do
    if [[ $first -eq 1 ]]; then first=0; else printf ", "; fi
    # Escape single quotes for SQL string literals
    printf "'%s'" "${name//\'/\'\'}"
  done
  printf ")"
}

IN_LIST="$(sql_quote_list "${ROM_SITE_NAMES[@]}")"

print_status() {
  echo "Database: $DB_PATH"
  echo
  echo "ROM-site providers (matched by name):"
  sqlite3 -header -column "$DB_PATH" \
    "SELECT id, name, enabled, kind, direct_download
     FROM search_providers
     WHERE name IN ${IN_LIST}
     ORDER BY id;"
  echo
  echo "All download-kind providers:"
  sqlite3 -header -column "$DB_PATH" \
    "SELECT id, name, enabled, direct_download
     FROM search_providers
     WHERE kind = 'download'
     ORDER BY id;"
}

if [[ "$STATUS_ONLY" -eq 1 ]]; then
  print_status
  exit 0
fi

UPDATE_SQL="
UPDATE search_providers
SET enabled = 1,
    direct_download = 1
WHERE name IN ${IN_LIST};
"

echo "==> Enabling ROM-site providers (enabled + direct_download)"
echo "    DB: $DB_PATH"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "    [dry-run] would run:"
  echo "$UPDATE_SQL" | sed 's/^/      /'
else
  BEFORE="$(sqlite3 "$DB_PATH" \
    "SELECT COUNT(*) FROM search_providers WHERE name IN ${IN_LIST};")"
  MATCHED="$(sqlite3 "$DB_PATH" \
    "SELECT COUNT(*) FROM search_providers
     WHERE name IN ${IN_LIST} AND (enabled = 0 OR direct_download = 0);")"
  sqlite3 "$DB_PATH" "$UPDATE_SQL"
  AFTER_ON="$(sqlite3 "$DB_PATH" \
    "SELECT COUNT(*) FROM search_providers
     WHERE name IN ${IN_LIST} AND enabled = 1 AND direct_download = 1;")"
  echo "    found ${BEFORE} known ROM-site row(s); updated ${MATCHED}; now fully on: ${AFTER_ON}"

  # Surface names in the list that are missing from this DB (never seeded / removed).
  MISSING=()
  for name in "${ROM_SITE_NAMES[@]}"; do
    exists="$(sqlite3 "$DB_PATH" \
      "SELECT COUNT(*) FROM search_providers WHERE name = '${name//\'/\'\'}';")"
    if [[ "$exists" -eq 0 ]]; then
      MISSING+=("$name")
    fi
  done
  if [[ ${#MISSING[@]} -gt 0 ]]; then
    echo "    note: not present in DB (skipped): ${MISSING[*]}"
  fi
fi

echo
print_status

if [[ "$ENABLE_ONLY" -eq 1 || "$DRY_RUN" -eq 1 ]]; then
  echo
  echo "Done (no launch)."
  exit 0
fi

resolve_mode() {
  if [[ "$MODE" != "auto" ]]; then
    echo "$MODE"
    return
  fi
  if [[ -d "$DEPLOY_APP" ]]; then
    echo "deployed"
  else
    echo "dev"
  fi
}

LAUNCH_MODE="$(resolve_mode)"
echo
echo "==> Launching (mode: ${LAUNCH_MODE})"

case "$LAUNCH_MODE" in
  deployed)
    if [[ ! -d "$DEPLOY_APP" ]]; then
      echo "error: deployed app not found: $DEPLOY_APP" >&2
      echo "Set RGP_DEPLOY_APP or use --dev." >&2
      exit 1
    fi
    # Re-open so a running instance still picks up DB changes on next search path.
    open -n "$DEPLOY_APP"
    echo "Opened: $DEPLOY_APP"
    ;;
  dev)
    cd "$ROOT"
    if [[ ! -d node_modules ]]; then
      echo "==> node_modules missing — running pnpm install"
      pnpm install
    fi
    echo "Starting: pnpm tauri dev  (cwd: $ROOT)"
    exec pnpm tauri dev
    ;;
  *)
    echo "error: unknown mode: $LAUNCH_MODE" >&2
    exit 1
    ;;
esac
