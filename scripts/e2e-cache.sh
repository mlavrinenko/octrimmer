#!/usr/bin/env bash
#
# End-to-end measure of what a trim does to the provider's prompt cache.
#
# One session, five turns, every reply a single step so entry numbers are
# known in advance:
#
#   1  bulk A, reply OK         #1 #2   kept: the prefix the trim must not touch
#   2  bulk B, reply OK         #3 #4   trimmed away
#   3  reply TWO                #5 #6   control: a turn with no trim
#   4  trim from #3                     the step after the call sees the cut
#   5  reply THREE                      follow-up: is the trimmed view cached?
#
# Numbers come from the `step_finish` events of `opencode run --format json`:
# per step, uncached input, cache reads and cache writes. Sandboxed like
# scripts/e2e.sh: own config and data homes, credentials borrowed by symlink.
#
#   MODEL=provider/model  which model to drive, required: free models come and
#                         go and few report cache reads; one that reports none
#                         stops the run after the control turn
#   KEEP=1                keep the sandbox for inspection instead of deleting
#   BULK_LINES=N          lines per bulk block (default 400, ~6k tokens)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE="$ROOT/dist/index.js"
STEP_TIMEOUT="${STEP_TIMEOUT:-600}"
BULK_LINES="${BULK_LINES:-400}"
# A step that should be served from cache: share of its prompt read from it.
WARM_PCT="${WARM_PCT:-80}"

passed=0
failed=0

say() { printf '%s\n' "$*"; }

check() {
    local label="$1" ok="$2" detail="${3:-}"
    if [ "$ok" = "yes" ]; then
        passed=$((passed + 1))
        printf '  \033[32mPASS\033[0m  %-44s %s\n' "$label" "$detail"
    else
        failed=$((failed + 1))
        printf '  \033[31mFAIL\033[0m  %-44s %s\n' "$label" "$detail"
    fi
}

need() {
    command -v "$1" >/dev/null 2>&1 || {
        say "missing required tool: $1"
        exit 127
    }
}

need opencode
need jq

[ -n "${MODEL:-}" ] || {
    say "pass a model that reports cache reads: just e2e-cache provider/model"
    exit 1
}

[ -f "$BUNDLE" ] || {
    say "no bundle at dist/index.js — run 'just build' first"
    exit 1
}

if command -v timeout >/dev/null 2>&1; then
    TIMEOUT=(timeout "$STEP_TIMEOUT")
elif command -v gtimeout >/dev/null 2>&1; then
    TIMEOUT=(gtimeout "$STEP_TIMEOUT")
else
    TIMEOUT=()
fi

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/octrimmer-e2e-cache-XXXXXX")"
# shellcheck disable=SC2329  # invoked by the trap below, not by name
cleanup() {
    if [ "${KEEP:-0}" = "1" ]; then
        say ""
        say "sandbox kept: $SANDBOX"
    else
        rm -rf "$SANDBOX"
    fi
}
trap cleanup EXIT

CONFIG="$SANDBOX/config"
DATA="$SANDBOX/data"
WORK="$SANDBOX/work"
mkdir -p "$CONFIG/opencode/plugins" "$DATA/opencode" "$WORK"
cp "$BUNDLE" "$CONFIG/opencode/plugins/octrimmer.js"

REAL_DATA="${XDG_DATA_HOME:-$HOME/.local/share}/opencode"
for credential in auth.json account.json; do
    [ -e "$REAL_DATA/$credential" ] && ln -s "$REAL_DATA/$credential" "$DATA/opencode/$credential"
done

RECORD_DIR="$DATA/opencode/storage/plugin/octrimmer"
SESSION=""

# Runs one turn of the session into $SANDBOX/turn-N.json; the first one opens it.
turn() {
    local n="$1" prompt="$2" out="$SANDBOX/turn-$1.json"
    local -a session=()
    [ -n "$SESSION" ] && session=(--session "$SESSION")
    (
        cd "$WORK"
        XDG_CONFIG_HOME="$CONFIG" XDG_DATA_HOME="$DATA" \
            "${TIMEOUT[@]}" opencode run "${session[@]}" "$prompt" -m "$MODEL" --format json
    ) >"$out" 2>"$out.err" || true
    local error
    error="$(jq -r 'select(.type=="error") | .error.data.message // .error.name' "$out" | head -1)"
    if [ -n "$error" ]; then
        say "provider error on $MODEL: $error"
        exit 1
    fi
    [ -n "$SESSION" ] || SESSION="$(jq -r 'select(.sessionID) | .sessionID' "$out" | head -1)"
    [ -n "$SESSION" ] || {
        say "turn $n opened no session; see $out.err"
        exit 1
    }
    say "  turn $n: $(steps "$n" | wc -l) step(s)"
}

# One line per step of turn N: prompt read write — prompt is everything sent,
# uncached input plus cache reads plus cache writes.
steps() {
    jq -r 'select(.type=="step_finish") | .part.tokens
        | "\(.input + .cache.read + .cache.write) \(.cache.read) \(.cache.write)"' \
        "$SANDBOX/turn-$1.json"
}
# Field F (1 prompt, 2 read, 3 write) of step S (1-based, or "last") of turn N.
tok() {
    local row
    if [ "$2" = last ]; then row="$(steps "$1" | tail -1)"; else row="$(steps "$1" | sed -n "$2p")"; fi
    printf '%s\n' "${row:-0 0 0}" | cut -d' ' -f"$3"
}
pct() { [ "$2" -gt 0 ] && echo $(($1 * 100 / $2)) || echo 0; }
yes_if() { if eval "$1"; then echo yes; else echo no; fi; }

# Deterministic filler: distinct lines, so no provider can dedupe it.
bulk() { awk -v tag="$1" -v n="$BULK_LINES" 'BEGIN { for (i = 1; i <= n; i++) printf "%s %04d: the ledger row %d carries checksum %x and no meaning.\n", tag, i, i * 7919, i * 2654435761 % 4294967296 }'; }

say ""
say "octrimmer E2E cache — $MODEL"
say "sandbox: $SANDBOX"
say ""

turn 1 "$(bulk alpha)
Reply with exactly OK and nothing else. Use no tools."
turn 2 "$(bulk bravo)
Reply with exactly OK and nothing else. Use no tools."
turn 3 "Reply with exactly TWO and nothing else. Use no tools."
turn 4 'Call the trim-context tool once with start set to "#3", summary set to "Bulk block bravo was here.", and actionRightAfterTrim set to "reply DONE". Then reply DONE.'
turn 5 "Reply with exactly THREE and nothing else. Use no tools."

# --- numbers -----------------------------------------------------------------

BEFORE="$(tok 3 1 1)"        # whole context on the control turn
CONTROL_READ="$(tok 3 1 2)"
KEPT="$(tok 1 1 3)"          # what turn 1 cached: system, tools and #1, all before the start
AFTER="$(tok 4 last 1)"      # the step that first sees the cut
AFTER_READ="$(tok 4 last 2)"
AFTER_WRITE="$(tok 4 last 3)"
NEXT="$(tok 5 1 1)"
NEXT_READ="$(tok 5 1 2)"

say ""
say "steps (prompt / cache read / cache write)"
for n in 1 2 3 4 5; do
    say "  turn $n: $(steps "$n" | tr '\n' ',' | sed 's/,$//; s/,/  |  /g')"
done
say ""

# --- checks ------------------------------------------------------------------

if [ "$CONTROL_READ" -eq 0 ]; then
    say "$MODEL reports no cache reads, so there is nothing to measure."
    say "pick one that does, e.g. just e2e-cache anthropic/claude-haiku-4-5"
    exit 1
fi

check "the untrimmed turn is served from cache" \
    "$(yes_if "[ $(pct "$CONTROL_READ" "$BEFORE") -ge $WARM_PCT ]")" \
    "$(pct "$CONTROL_READ" "$BEFORE")% of $BEFORE"

TRIMS="$(jq -s '[.[] | select(.type=="tool_use" and .part.tool=="trim-context" and .part.state.status=="completed")] | length' "$SANDBOX/turn-4.json")"
check "the model trimmed once" "$(yes_if "[ $TRIMS -eq 1 ] && [ -f '$RECORD_DIR/$SESSION.json' ]")" \
    "$TRIMS completed trim-context call(s)"
[ "$TRIMS" -ge 1 ] || {
    say ""
    say "no trim to measure — model compliance, not the cache. Re-run or pick a stronger MODEL."
    exit 1
}

check "the trim shrank the context" "$(yes_if "[ $AFTER -lt $BEFORE ]")" "$BEFORE → $AFTER"

# The README's promise: everything before the start is byte-identical, so it
# is still read from cache. #1 carries bulk A, so a read short of what turn 1
# wrote means only the system prompt survived and the prefix went cold.
check "the prefix before the start stays cached" \
    "$(yes_if "[ $AFTER_READ -ge $KEPT ]")" \
    "read $AFTER_READ of the $KEPT before #3"

# The trimmed view is rebuilt on every request; if it is not byte-stable, every
# later step pays for it again.
check "the trimmed context is cached next turn" \
    "$(yes_if "[ $(pct "$NEXT_READ" "$NEXT") -ge $WARM_PCT ]")" \
    "$(pct "$NEXT_READ" "$NEXT")% of $NEXT"

say ""
say "stats"
printf '  %-26s %s\n' "model" "$MODEL"
printf '  %-26s %s\n' "context before, after" "$BEFORE → $AFTER tokens"
printf '  %-26s %s\n' "trim cost (cache write)" "$AFTER_WRITE tokens, once"
printf '  %-26s %s\n' "saved per later step" "$((BEFORE - AFTER)) tokens"

say ""
if [ "$failed" -eq 0 ]; then
    printf '\033[32m%d passed\033[0m, %d failed\n' "$passed" "$failed"
else
    printf '%d passed, \033[31m%d failed\033[0m\n' "$passed" "$failed"
fi
exit $((failed > 0))
