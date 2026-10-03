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
# per step, uncached input, cache reads and cache writes. Sandboxed by
# scripts/e2e-sandbox.sh.
#
#   MODEL=provider/model  which model to drive, required: free models come and
#                         go and few report cache reads; one that reports none
#                         stops the run after the control turn
#   KEEP=1                keep the sandbox for inspection instead of deleting
#   RECORD=1              on a full pass, write the numbers to
#                         docs/measured/cache.json, which the README shows
#   BULK_LINES=N          lines per bulk block (default 400, ~6k tokens)

set -euo pipefail

BULK_LINES="${BULK_LINES:-400}"
# A step that should be served from cache: share of its prompt read from it.
WARM_PCT="${WARM_PCT:-80}"

[ -n "${MODEL:-}" ] || {
    echo "pass a model that reports cache reads: just e2e-cache provider/model"
    exit 1
}

# shellcheck source=scripts/e2e-sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/e2e-sandbox.sh"

SESSION=""

# Runs one turn of the session into $SANDBOX/turn-N.json; the first one opens it.
turn() {
    local n="$1" prompt="$2" out="$SANDBOX/turn-$1.json"
    local -a session=()
    [ -n "$SESSION" ] && session=(--session "$SESSION")
    run_opencode "$out" "${session[@]}" "$prompt"
    [ -n "$SESSION" ] || SESSION="$(session_of "$out")"
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

if [ "${RECORD:-0}" = 1 ] && [ "$failed" -eq 0 ]; then
    mkdir -p "$ROOT/docs/measured"
    jq -n --indent 4 --arg model "$MODEL" --argjson before "$BEFORE" --argjson after "$AFTER" \
        --argjson kept "$KEPT" --argjson read "$AFTER_READ" --argjson write "$AFTER_WRITE" \
        --argjson next "$(pct "$NEXT_READ" "$NEXT")" \
        '{model: $model, before: $before, after: $after, kept: $kept, keptRead: $read, trimWrite: $write, nextCachedPct: $next}' \
        >"$ROOT/docs/measured/cache.json"
    say ""
    say "recorded: docs/measured/cache.json"
fi

finish
