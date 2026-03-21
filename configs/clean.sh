#!/bin/bash
# Clean xiboplayer data for testing without losing display authorization
#
# Usage:
#   clean.sh <instance> [level]
#
# Levels:
#   content  — remove downloaded media/layouts only (default)
#   browser  — remove browser caches (Code Cache, GPUCache, etc.) + content
#   full     — remove everything EXCEPT auth (hardwareKey in IndexedDB + localStorage)
#   nuke     — remove absolutely everything (will need re-authorization)
#
# Examples:
#   clean.sh electron              # clear content cache, keep auth + browser state
#   clean.sh electron browser      # clear browser caches + content
#   clean.sh electron full         # fresh start but keep display authorized
#   clean.sh electron nuke         # total wipe, new display identity
#
# Directory map (sessionData = ~/.local/share/xiboplayer/<instance>/):
#
#   Config dir (~/.config/xiboplayer/<instance>/):
#     config.json        — CMS URL, display name, controls, sync config
#     .pwa-version       — tracks bundled PWA version for Code Cache invalidation
#     Crashpad/          — crash dump reports
#
#   Session dir (~/.local/share/xiboplayer/<instance>/):
#     Local Storage/     — AUTH: hardwareKey, xmrChannel, CMS config (localStorage)
#     IndexedDB/         — AUTH: hardwareKey backup, xmrPubKey/xmrPrivKey
#                          CONTENT: offline schedule cache, stats, logs
#     Service Worker/    — SW registration, script cache, CacheStorage (precache)
#     Cache/             — HTTP cache (Chromium disk cache for fetched resources)
#     Code Cache/        — V8 compiled bytecode (invalidate on PWA version change)
#     GPUCache/          — GPU shader compilation cache
#     DawnGraphiteCache/ — Dawn/WebGPU shader cache
#     DawnWebGPUCache/   — Dawn/WebGPU pipeline cache
#     blob_storage/      — temporary Blob URL storage
#     Session Storage/   — per-tab session data (ephemeral)
#     Cookies*           — cookie jar
#     Preferences        — Chromium preferences
#     Dictionaries/      — spellcheck dictionaries
#     Shared Dictionary/ — shared compression dictionaries (Brotli)
#     WebStorage/        — additional web storage
#
#   Shared content cache (~/.local/share/xiboplayer/shared/):
#     cache/<cmsId>/media/  — ContentStore: downloaded media files (chunked)
#                             Shared across all instances on the same machine.
#                             Keyed by CMS ID for per-CMS isolation.

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <instance> [content|browser|full|nuke]"
  echo ""
  echo "Levels:"
  echo "  content  — downloaded media/layouts only (default)"
  echo "  browser  — browser caches + content"
  echo "  full     — everything except auth (keeps display authorized)"
  echo "  nuke     — total wipe (will need re-authorization)"
  exit 1
fi

INSTANCE="$1"
LEVEL="${2:-content}"

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/xiboplayer/$INSTANCE"
SESSION_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/xiboplayer/$INSTANCE"
SHARED_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/xiboplayer/shared"

if [ ! -d "$CONFIG_DIR" ] && [ ! -d "$SESSION_DIR" ]; then
  echo "Instance '$INSTANCE' not found"
  exit 1
fi

# Content: shared media cache
clean_content() {
  echo "Clearing content cache (shared media)..."
  rm -rf "$SHARED_DIR"/cache/*/media
  # Also clear Service Worker CacheStorage (precached responses)
  rm -rf "$SESSION_DIR/Service Worker/CacheStorage"
}

# Browser: Chromium rendering/compilation caches
clean_browser() {
  echo "Clearing browser caches..."
  rm -rf "$SESSION_DIR"/{Cache,Code\ Cache,GPUCache,DawnGraphiteCache,DawnWebGPUCache}
  rm -rf "$SESSION_DIR"/{blob_storage,Shared\ Dictionary,Dictionaries,WebStorage}
  rm -f "$CONFIG_DIR/.pwa-version"
}

# Auth-safe full: everything except Local Storage + IndexedDB auth keys
clean_full() {
  echo "Clearing all data except auth..."
  # Remove everything in session dir except Local Storage and IndexedDB
  find "$SESSION_DIR" -mindepth 1 -maxdepth 1 \
    ! -name "Local Storage" ! -name "IndexedDB" \
    -exec rm -rf {} + 2>/dev/null
  rm -rf "$SHARED_DIR"/cache/*/media
  rm -f "$CONFIG_DIR/.pwa-version"
  rm -rf "$CONFIG_DIR/Crashpad"
}

# Nuclear: everything
clean_nuke() {
  echo "Nuking all data (will need re-authorization)..."
  rm -rf "$SESSION_DIR"
  rm -rf "$SHARED_DIR"/cache/*/media
  rm -f "$CONFIG_DIR/.pwa-version"
  rm -rf "$CONFIG_DIR/Crashpad"
}

case "$LEVEL" in
  content)
    clean_content
    ;;
  browser)
    clean_browser
    clean_content
    ;;
  full)
    clean_full
    ;;
  nuke)
    clean_nuke
    ;;
  *)
    echo "Unknown level: $LEVEL (use content|browser|full|nuke)"
    exit 1
    ;;
esac

echo "Done: $INSTANCE ($LEVEL)"
