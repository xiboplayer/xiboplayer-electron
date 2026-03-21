#!/bin/bash
# Apply a config template to a player instance
#
# Usage:
#   apply.sh <template> <player> [VAR=value ...]
#
# Examples:
#   apply.sh electron-dev electron
#   apply.sh electron-dev electron DISPLAY_NAME=my-test PORT=8770
#   apply.sh electron-sync-follower electron-sync-follower-1 PORT=8771 DISPLAY_NAME=follower-1 TOPOLOGY_X=1
#
# Template syntax:
#   {{VAR}}          — replaced by env/secrets/CLI value (error if unset)
#   {{VAR:default}}  — replaced by env/secrets/CLI value, or default if unset
#
# Secrets are loaded from secrets.env (same dir as templates).
# CLI VAR=value args override secrets.env.
# Empty values (e.g. API_CLIENT_ID=) produce empty strings → keys with ""
# are removed from the final JSON to avoid sending empty auth fields.

set -euo pipefail

CONFIGS_DIR="$(cd "$(dirname "$0")" && pwd)"
XIBO_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/xiboplayer"

if [ $# -lt 2 ]; then
  echo "Usage: $0 <template> <player-instance> [VAR=value ...]"
  echo ""
  echo "Templates:"
  ls "$CONFIGS_DIR"/*.json 2>/dev/null | xargs -I{} basename {} .json | sed 's/^/  /'
  echo ""
  echo "Secrets loaded from: $CONFIGS_DIR/secrets.env"
  exit 1
fi

TEMPLATE="$1"
INSTANCE="$2"
shift 2

TEMPLATE_FILE="$CONFIGS_DIR/${TEMPLATE}.json"
if [ ! -f "$TEMPLATE_FILE" ]; then
  echo "Template not found: $TEMPLATE_FILE"
  exit 1
fi

# Load secrets from secrets.env (key=value, skip comments/blanks)
if [ -f "$CONFIGS_DIR/secrets.env" ]; then
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    export "$key=$value"
  done < "$CONFIGS_DIR/secrets.env"
fi

# CLI args override secrets.env
for arg in "$@"; do
  key="${arg%%=*}"
  value="${arg#*=}"
  export "$key=$value"
done

# Process template: replace {{VAR:default}} and {{VAR}}
CONFIG=$(cat "$TEMPLATE_FILE")

# Replace {{VAR:default}} — use env value if set, otherwise default
CONFIG=$(echo "$CONFIG" | sed -E 's/\{\{([A-Z_]+):([^}]*)\}\}/%%\1:\2%%/g')
while [[ "$CONFIG" =~ %%([A-Z_]+):([^%]*)%% ]]; do
  var="${BASH_REMATCH[1]}"
  default="${BASH_REMATCH[2]}"
  value="${!var:-$default}"
  CONFIG="${CONFIG//"%%${var}:${default}%%"/$value}"
done

# Replace {{VAR}} — use env value (empty string if unset)
while [[ "$CONFIG" =~ \{\{([A-Z_]+)\}\} ]]; do
  var="${BASH_REMATCH[1]}"
  value="${!var:-}"
  CONFIG="${CONFIG//\{\{${var}\}\}/$value}"
done

# Remove JSON keys with empty string values (e.g. "apiClientId": "")
# This prevents sending empty auth fields to the CMS
CONFIG=$(echo "$CONFIG" | grep -v '^\s*"[^"]*":\s*""' | sed 's/,\s*}/\n}/g')

# Ensure target directory exists
TARGET_DIR="$XIBO_CONFIG/$INSTANCE"
mkdir -p "$TARGET_DIR"

# Clear content + browser caches but keep auth
"$CONFIGS_DIR/clean.sh" "$INSTANCE" full 2>/dev/null || true

# Write config
echo "$CONFIG" > "$TARGET_DIR/config.json"
echo "Applied $TEMPLATE → $TARGET_DIR/config.json"
