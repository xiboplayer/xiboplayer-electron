#!/usr/bin/env bash
# =============================================================================
# Xibo Player — Debug Monitor
#
# Starts the Electron player with full diagnostics, monitors for memory leaks,
# OOMs, and crashes. Logs everything to timestamped files.
#
# Usage:
#   ./scripts/monitor-player.sh                  # default: --dev --no-kiosk
#   ./scripts/monitor-player.sh --kiosk          # fullscreen kiosk mode
#   ./scripts/monitor-player.sh --instance=lobby # named instance
#   ./scripts/monitor-player.sh --duration=24h   # auto-stop after 24 hours
#
# Output:
#   /tmp/xiboplayer-monitor-<timestamp>/
#     player.log        — full Electron stdout/stderr
#     memory.csv        — periodic memory samples (RSS, heap, GPU)
#     cdp-heap.log      — V8 heap snapshots via CDP
#     events.log        — OOM kills, crashes, restarts
#     summary.txt       — final report
# =============================================================================

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────

CDP_PORT="${CDP_PORT:-9223}"
SAMPLE_INTERVAL="${SAMPLE_INTERVAL:-10}"          # seconds between memory samples
HEAP_SNAPSHOT_INTERVAL="${HEAP_SNAPSHOT_INTERVAL:-300}"  # seconds between CDP heap queries
OOM_THRESHOLD_MB="${OOM_THRESHOLD_MB:-2048}"       # warn if RSS exceeds this
RESTART_ON_CRASH="${RESTART_ON_CRASH:-true}"
MAX_RESTARTS="${MAX_RESTARTS:-5}"
DURATION=""
EXTRA_ARGS=("--dev" "--no-kiosk")

# Parse our arguments (pass the rest to Electron)
PLAYER_ARGS=()
for arg in "$@"; do
    case "$arg" in
        --kiosk)        EXTRA_ARGS=() ;;
        --duration=*)   DURATION="${arg#*=}" ;;
        --cdp-port=*)   CDP_PORT="${arg#*=}" ;;
        --interval=*)   SAMPLE_INTERVAL="${arg#*=}" ;;
        --no-restart)   RESTART_ON_CRASH=false ;;
        *)              PLAYER_ARGS+=("$arg") ;;
    esac
done

# ── Setup ────────────────────────────────────────────────────────────────────

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
MONITOR_BASE="${XDG_CONFIG_HOME:-$HOME/.config}/xiboplayer/monitoring"
LOGDIR="${MONITOR_BASE}/${TIMESTAMP}"
mkdir -p "$LOGDIR"

# Prune old sessions (keep last 10)
ls -dt "$MONITOR_BASE"/20* 2>/dev/null | tail -n +11 | xargs rm -rf 2>/dev/null || true

PLAYER_LOG="$LOGDIR/player.log"
MEMORY_CSV="$LOGDIR/memory.csv"
CDP_LOG="$LOGDIR/cdp-heap.log"
EVENTS_LOG="$LOGDIR/events.log"
SUMMARY="$LOGDIR/summary.txt"

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON_BIN="${SCRIPT_DIR}/node_modules/.bin/electron"
MAIN_JS="${SCRIPT_DIR}/src/main.js"

PLAYER_PID=""
MONITOR_PIDS=()
RESTART_COUNT=0
START_TIME=$(date +%s)
PEAK_RSS=0
TOTAL_CRASHES=0

# Colors
RED='\033[0;31m'
YEL='\033[1;33m'
GRN='\033[0;32m'
CYN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYN}[$(date +%H:%M:%S)]${NC} $*"; echo "[$(date +%H:%M:%S)] $*" >> "$EVENTS_LOG"; }
warn() { echo -e "${YEL}[$(date +%H:%M:%S)] WARN${NC} $*"; echo "[$(date +%H:%M:%S)] WARN $*" >> "$EVENTS_LOG"; }
err()  { echo -e "${RED}[$(date +%H:%M:%S)] ERROR${NC} $*"; echo "[$(date +%H:%M:%S)] ERROR $*" >> "$EVENTS_LOG"; }

# ── Cleanup ──────────────────────────────────────────────────────────────────

cleanup() {
    log "Shutting down..."
    for pid in "${MONITOR_PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    if [ -n "$PLAYER_PID" ] && kill -0 "$PLAYER_PID" 2>/dev/null; then
        kill "$PLAYER_PID" 2>/dev/null
        wait "$PLAYER_PID" 2>/dev/null || true
    fi
    write_summary
    log "Logs saved to: $LOGDIR"
}
trap cleanup EXIT INT TERM

# ── Duration timer ───────────────────────────────────────────────────────────

if [ -n "$DURATION" ]; then
    # Convert duration to seconds
    case "$DURATION" in
        *h) DURATION_SECS=$(( ${DURATION%h} * 3600 )) ;;
        *m) DURATION_SECS=$(( ${DURATION%m} * 60 )) ;;
        *s) DURATION_SECS=${DURATION%s} ;;
        *)  DURATION_SECS=$DURATION ;;
    esac
    log "Auto-stop after ${DURATION} (${DURATION_SECS}s)"
    ( sleep "$DURATION_SECS" && kill -TERM $$ 2>/dev/null ) &
    MONITOR_PIDS+=($!)
fi

# ── Start player ────────────────────────────────────────────────────────────

start_player() {
    log "Starting Electron player (CDP port $CDP_PORT)..."
    XIBOPLAYER_DEBUG_PORT="$CDP_PORT" \
        "$ELECTRON_BIN" "$MAIN_JS" "${EXTRA_ARGS[@]}" "${PLAYER_ARGS[@]}" \
        >> "$PLAYER_LOG" 2>&1 &
    PLAYER_PID=$!
    log "Player PID: $PLAYER_PID"

    # Wait for CDP to be available
    for i in $(seq 1 30); do
        if curl -sf "http://127.0.0.1:${CDP_PORT}/json/version" > /dev/null 2>&1; then
            log "CDP ready on port $CDP_PORT"
            return 0
        fi
        sleep 1
    done
    warn "CDP not responding after 30s — monitoring without CDP"
}

# ── Memory monitor (procfs) ─────────────────────────────────────────────────

echo "timestamp,elapsed_s,rss_mb,vsz_mb,threads,open_fds,gpu_rss_mb" > "$MEMORY_CSV"

monitor_memory() {
    while true; do
        sleep "$SAMPLE_INTERVAL"
        [ -n "$PLAYER_PID" ] && kill -0 "$PLAYER_PID" 2>/dev/null || continue

        local now=$(date +%s)
        local elapsed=$(( now - START_TIME ))
        local ts=$(date -Iseconds)

        # Main process RSS/VSZ
        local rss_kb vsz_kb threads
        read -r vsz_kb rss_kb threads < <(ps -o vsz=,rss=,nlwp= -p "$PLAYER_PID" 2>/dev/null || echo "0 0 0")
        local rss_mb=$(( rss_kb / 1024 ))
        local vsz_mb=$(( vsz_kb / 1024 ))

        # Open file descriptors
        local fds=$(ls /proc/"$PLAYER_PID"/fd 2>/dev/null | wc -l || echo 0)

        # GPU process RSS (child processes)
        local gpu_rss=0
        for child in $(pgrep -P "$PLAYER_PID" 2>/dev/null); do
            local child_cmdline=$(tr '\0' ' ' < /proc/"$child"/cmdline 2>/dev/null || true)
            if [[ "$child_cmdline" == *"--type=gpu"* ]]; then
                local child_rss=$(awk '/^VmRSS:/{print $2}' /proc/"$child"/status 2>/dev/null || echo 0)
                gpu_rss=$(( gpu_rss + child_rss / 1024 ))
            fi
        done

        # Total RSS across all Electron processes
        local total_rss=0
        for p in "$PLAYER_PID" $(pgrep -P "$PLAYER_PID" 2>/dev/null); do
            local p_rss=$(awk '/^VmRSS:/{print $2}' /proc/"$p"/status 2>/dev/null || echo 0)
            total_rss=$(( total_rss + p_rss / 1024 ))
        done

        # Track peak
        [ "$total_rss" -gt "$PEAK_RSS" ] && PEAK_RSS=$total_rss

        echo "$ts,$elapsed,$rss_mb,$vsz_mb,$threads,$fds,$gpu_rss" >> "$MEMORY_CSV"

        # OOM warning
        if [ "$total_rss" -gt "$OOM_THRESHOLD_MB" ]; then
            warn "MEMORY: total RSS ${total_rss}MB exceeds threshold ${OOM_THRESHOLD_MB}MB"
        fi

        # Leak detection: check if RSS grew >50% in the last hour
        if [ "$elapsed" -gt 3600 ]; then
            local hour_ago_rss=$(awk -F, -v t=$((elapsed - 3600)) '$2 > t {print $3; exit}' "$MEMORY_CSV" 2>/dev/null || echo 0)
            if [ "$hour_ago_rss" -gt 0 ] && [ "$rss_mb" -gt $(( hour_ago_rss * 150 / 100 )) ]; then
                warn "LEAK: RSS grew from ${hour_ago_rss}MB to ${rss_mb}MB in the last hour (+$(( (rss_mb - hour_ago_rss) * 100 / hour_ago_rss ))%)"
            fi
        fi
    done
}

# ── CDP heap monitor ────────────────────────────────────────────────────────

monitor_cdp_heap() {
    sleep 10  # wait for player to settle
    while true; do
        sleep "$HEAP_SNAPSHOT_INTERVAL"

        # Get V8 heap stats via CDP
        local ws_url
        ws_url=$(curl -sf "http://127.0.0.1:${CDP_PORT}/json" 2>/dev/null | python3 -c "
import sys, json
try:
    pages = json.load(sys.stdin)
    for p in pages:
        if 'webSocketDebuggerUrl' in p:
            print(p['webSocketDebuggerUrl'])
            break
except: pass
" 2>/dev/null || true)

        if [ -z "$ws_url" ]; then continue; fi

        # Query heap via HTTP endpoint (simpler than WebSocket)
        local heap_info
        heap_info=$(curl -sf "http://127.0.0.1:${CDP_PORT}/json" 2>/dev/null | python3 -c "
import sys, json
try:
    pages = json.load(sys.stdin)
    for p in pages:
        title = p.get('title', '')
        url = p.get('url', '')
        print(f'{title} | {url}')
except: pass
" 2>/dev/null || true)

        if [ -n "$heap_info" ]; then
            echo "[$(date -Iseconds)] CDP pages: $heap_info" >> "$CDP_LOG"
        fi

        # Get performance metrics if available
        local perf
        perf=$(curl -sf "http://127.0.0.1:${CDP_PORT}/json/protocol" > /dev/null 2>&1 && echo "ok" || echo "")
        if [ "$perf" = "ok" ]; then
            # Use CDP Runtime.evaluate to get memory info
            local mem_info
            mem_info=$(curl -sf "http://127.0.0.1:${CDP_PORT}/json" 2>/dev/null | python3 -c "
import sys, json
try:
    pages = json.load(sys.stdin)
    print(json.dumps({
        'pages': len(pages),
        'titles': [p.get('title','?')[:50] for p in pages]
    }))
except: pass
" 2>/dev/null || true)
            [ -n "$mem_info" ] && echo "[$(date -Iseconds)] CDP status: $mem_info" >> "$CDP_LOG"
        fi
    done
}

# ── Crash monitor ───────────────────────────────────────────────────────────

monitor_crashes() {
    while true; do
        if [ -n "$PLAYER_PID" ]; then
            if ! kill -0 "$PLAYER_PID" 2>/dev/null; then
                wait "$PLAYER_PID" 2>/dev/null
                EXIT_CODE=$?
                TOTAL_CRASHES=$((TOTAL_CRASHES + 1))

                if [ $EXIT_CODE -eq 137 ]; then
                    err "KILLED: Player was OOM-killed (signal 9, exit 137)"
                elif [ $EXIT_CODE -eq 139 ]; then
                    err "SEGFAULT: Player crashed with segfault (signal 11, exit 139)"
                elif [ $EXIT_CODE -eq 134 ]; then
                    err "ABORT: Player aborted (signal 6, exit 134)"
                elif [ $EXIT_CODE -ne 0 ]; then
                    err "CRASH: Player exited with code $EXIT_CODE"
                else
                    log "Player exited cleanly (code 0)"
                    return
                fi

                # Check dmesg for OOM
                dmesg -T 2>/dev/null | tail -5 | grep -i "oom\|killed process" >> "$EVENTS_LOG" 2>/dev/null || true

                if [ "$RESTART_ON_CRASH" = "true" ] && [ "$RESTART_COUNT" -lt "$MAX_RESTARTS" ]; then
                    RESTART_COUNT=$((RESTART_COUNT + 1))
                    warn "Restarting (attempt $RESTART_COUNT/$MAX_RESTARTS)..."
                    sleep 3
                    start_player
                else
                    err "Max restarts ($MAX_RESTARTS) reached or restart disabled. Stopping."
                    return
                fi
            fi
        fi
        sleep 2
    done
}

# ── Journal monitor (systemd OOM, GPU errors) ──────────────────────────────

monitor_journal() {
    journalctl --user -f -n 0 -o short-iso 2>/dev/null | while IFS= read -r line; do
        case "$line" in
            *"oom"*|*"OOM"*|*"Out of memory"*)
                err "JOURNAL OOM: $line" ;;
            *"GPU process"*|*"SharedImage"*|*"render-process-gone"*)
                warn "JOURNAL GPU: $line" ;;
            *"xiboplayer"*"error"*|*"xiboplayer"*"crash"*)
                warn "JOURNAL: $line" ;;
        esac
    done >> "$EVENTS_LOG" 2>/dev/null &
    MONITOR_PIDS+=($!)
}

# ── Summary ──────────────────────────────────────────────────────────────────

write_summary() {
    local end_time=$(date +%s)
    local runtime=$(( end_time - START_TIME ))
    local hours=$(( runtime / 3600 ))
    local mins=$(( (runtime % 3600) / 60 ))

    # Memory stats from CSV
    local avg_rss min_rss max_rss samples
    if [ -f "$MEMORY_CSV" ] && [ "$(wc -l < "$MEMORY_CSV")" -gt 1 ]; then
        samples=$(( $(wc -l < "$MEMORY_CSV") - 1 ))
        avg_rss=$(awk -F, 'NR>1{s+=$3;n++}END{printf "%.0f", s/n}' "$MEMORY_CSV")
        min_rss=$(awk -F, 'NR>1{if(!m||$3<m)m=$3}END{print m}' "$MEMORY_CSV")
        max_rss=$(awk -F, 'NR>1{if($3>m)m=$3}END{print m}' "$MEMORY_CSV")
    else
        samples=0; avg_rss=0; min_rss=0; max_rss=0
    fi

    local warnings=$(grep -c "WARN" "$EVENTS_LOG" 2>/dev/null || echo 0)
    local errors=$(grep -c "ERROR" "$EVENTS_LOG" 2>/dev/null || echo 0)

    cat > "$SUMMARY" << EOF
=====================================
  Xibo Player Monitor — Summary
=====================================

Runtime:     ${hours}h ${mins}m (${runtime}s)
Crashes:     ${TOTAL_CRASHES}
Restarts:    ${RESTART_COUNT}
Warnings:    ${warnings}
Errors:      ${errors}

Memory (main process RSS):
  Average:   ${avg_rss} MB
  Min:       ${min_rss} MB
  Max:       ${max_rss} MB
  Peak total: ${PEAK_RSS} MB (all Electron processes)
  Samples:   ${samples} (every ${SAMPLE_INTERVAL}s)

OOM threshold: ${OOM_THRESHOLD_MB} MB
CDP port:      ${CDP_PORT}

Files:
  ${PLAYER_LOG}
  ${MEMORY_CSV}
  ${CDP_LOG}
  ${EVENTS_LOG}

$(if [ "$TOTAL_CRASHES" -eq 0 ] && [ "$errors" -eq 0 ]; then
    echo "Result: STABLE — no crashes or errors"
elif [ "$TOTAL_CRASHES" -eq 0 ]; then
    echo "Result: WARNINGS — check events.log"
else
    echo "Result: UNSTABLE — ${TOTAL_CRASHES} crash(es)"
fi)
=====================================
EOF

    cat "$SUMMARY"
}

# ── Main ─────────────────────────────────────────────────────────────────────

echo -e "${GRN}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║   Xibo Player Debug Monitor              ║"
echo "  ╠══════════════════════════════════════════╣"
echo "  ║  Logs: $LOGDIR"
echo "  ║  CDP:  http://127.0.0.1:${CDP_PORT}"
echo "  ║  Stop: Ctrl+C"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${NC}"

start_player
monitor_memory &
MONITOR_PIDS+=($!)
monitor_cdp_heap &
MONITOR_PIDS+=($!)
monitor_journal
monitor_crashes

# Wait for crash monitor to exit (player stopped or max restarts)
wait
