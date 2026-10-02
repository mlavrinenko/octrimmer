#!/usr/bin/env bash
#
# End-to-end check against a real opencode and a real model.
#
# Runs in a sandbox: its own XDG_CONFIG_HOME (so the only plugin loaded is the
# bundle under test — none of the operator's global plugins, agents or rules)
# and its own XDG_DATA_HOME (so the trim records read back are this run's and
# nothing else). Credentials are the one thing borrowed from the real profile,
# by symlink rather than copy.
#
#   MODEL=provider/model  which model to drive (default below)
#   KEEP=1                keep the sandbox for inspection instead of deleting
#
# Exits non-zero if any assertion fails. Model-dependent behaviour (does it
# reach for references at all?) is reported as a statistic, not an assertion —
# a weaker model should read as a worse score, not as a broken plugin.

set -euo pipefail

MODEL="${MODEL:-opencode/mimo-v2.5-free}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE="$ROOT/dist/index.js"
STEP_TIMEOUT="${STEP_TIMEOUT:-600}"

passed=0
failed=0
declare -a STATS=()

say() { printf '%s\n' "$*"; }
stat_line() { STATS+=("$(printf '  %-22s %s' "$1" "$2")"); }

check() {
    local label="$1" ok="$2" detail="${3:-}"
    if [ "$ok" = "yes" ]; then
        passed=$((passed + 1))
        printf '  \033[32mPASS\033[0m  %-38s %s\n' "$label" "$detail"
    else
        failed=$((failed + 1))
        printf '  \033[31mFAIL\033[0m  %-38s %s\n' "$label" "$detail"
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

[ -f "$BUNDLE" ] || {
    say "no bundle at dist/index.js — run 'just build' first"
    exit 1
}

# `timeout` is coreutils; macOS ships it as gtimeout, or not at all. A missing
# one is not worth failing over — the run just has no ceiling.
if command -v timeout >/dev/null 2>&1; then
    TIMEOUT=(timeout "$STEP_TIMEOUT")
elif command -v gtimeout >/dev/null 2>&1; then
    TIMEOUT=(gtimeout "$STEP_TIMEOUT")
else
    TIMEOUT=()
fi

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/octrimmer-e2e-XXXXXX")"
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

# Auth lives in the data home, which the sandbox replaces. Link the real files
# in so the run can authenticate without copying credentials anywhere.
REAL_DATA="${XDG_DATA_HOME:-$HOME/.local/share}/opencode"
for credential in auth.json account.json; do
    [ -e "$REAL_DATA/$credential" ] && ln -s "$REAL_DATA/$credential" "$DATA/opencode/$credential"
done

RECORD_DIR="$DATA/opencode/storage/plugin/octrimmer"

run_opencode() {
    local out="$1"
    shift
    (
        cd "$WORK"
        XDG_CONFIG_HOME="$CONFIG" XDG_DATA_HOME="$DATA" \
            "${TIMEOUT[@]}" opencode run "$@" -m "$MODEL" --format json
    ) >"$out" 2>"$out.err" || true
}

# --- event stream readers -----------------------------------------------------

texts() { jq -r 'select(.type=="text") | .part.text' "$1"; }
session_of() { jq -r 'select(.sessionID) | .sessionID' "$1" | head -1; }
tool_calls() { jq -r --arg t "$2" 'select(.type=="tool_use") | select(.part.tool==$t) | .part.tool' "$1" | wc -l; }
tokens_of() { jq -c 'select(.type=="step_finish") | .part.tokens' "$1"; }

say ""
say "octrimmer E2E — $MODEL"
say "sandbox: $SANDBOX"
say ""

# --- 1. the tool reaches the model -------------------------------------------

say "[1/3] tool registration"
REG="$SANDBOX/registration.json"
run_opencode "$REG" "List your available tools as a comma list."

if texts "$REG" | grep -q "trim-context"; then
    check "trim-context is offered to the model" yes
else
    check "trim-context is offered to the model" no "$(texts "$REG" | tail -2)"
    say ""
    say "the model never saw the tool — later checks would be noise. stopping."
    exit 1
fi

# --- 2. a trim that pulls content forward ------------------------------------

say ""
say "[2/3] trim with a verbatim reference"
# Every decision the prompt can make for the model, it makes: "#1" is the user
# turn, which is always a real message on a fresh session. What is left to the
# model is the part under test — composing a summary that references instead of
# restating. Small models still wander off, so the scenario is retried; the
# attempt count is reported, because needing three goes IS the finding.
TRIM_PROMPT='Do exactly three things, in order, and do not stop early.
1. Write a 4-line poem about rain.
2. Call the trim-context tool with no arguments and read the numbered list it returns.
3. Call trim-context a second time with start set to "#1" and summary set to one short sentence followed by a [[#N]] reference pointing at the entry that holds your poem, and next set to "reply DONE".
Then reply DONE.'

ATTEMPTS="${E2E_ATTEMPTS:-3}"
TRIM="$SANDBOX/trim.json"
SESSION=""
CALLS=0
RECORD_FILE=""
attempt=0

while [ "$attempt" -lt "$ATTEMPTS" ]; do
    attempt=$((attempt + 1))
    TRIM="$SANDBOX/trim-$attempt.json"
    run_opencode "$TRIM" "$TRIM_PROMPT"
    SESSION="$(session_of "$TRIM")"
    CALLS="$(tool_calls "$TRIM" trim-context)"
    [ -n "$SESSION" ] || continue
    if [ -f "$RECORD_DIR/$SESSION.json" ]; then
        RECORD_FILE="$RECORD_DIR/$SESSION.json"
        break
    fi
    [ "$attempt" -lt "$ATTEMPTS" ] && say "  ....  attempt $attempt: model made $CALLS call(s) and no trim — retrying"
done

check "the model called trim-context" \
    "$([ "$CALLS" -ge 2 ] && echo yes || echo no)" \
    "$CALLS calls on attempt $attempt of $ATTEMPTS"

if [ -n "$RECORD_FILE" ]; then
    check "a trim record was persisted" yes "$(basename "$RECORD_FILE")"
else
    check "a trim record was persisted" no "the model never completed a trim in $ATTEMPTS attempts"
    say ""
    say "no record to inspect — this is a model-compliance failure, not necessarily a"
    say "plugin one. Re-run with a stronger MODEL to tell the two apart."
    exit 1
fi

# How MANY records exist is the model's business: trimming again further down
# the conversation is a legitimate second record. What must never happen is two
# records anchored on the same message — that is a summary stacked on a summary,
# which cover-replace exists to prevent.
RECORDS="$(jq '.records | length' "$RECORD_FILE")"
ANCHORS="$(jq -r '[.records[].startRawId] | unique | length' "$RECORD_FILE")"
check "no two records share an anchor" \
    "$([ "$ANCHORS" = "$RECORDS" ] && echo yes || echo no)" \
    "$RECORDS record(s), $ANCHORS distinct anchor(s)"

SCHEMA_OK="$(jq -r '[.records[] | has("startRawId") and has("endRawId") and (has("startPosition")|not)] | if all then "yes" else "no" end' "$RECORD_FILE")"
check "spans addressed by message id" "$SCHEMA_OK" \
    "$(jq -r '.records[0] | "\(.startRawId) → \(.endRawId)"' "$RECORD_FILE")"

REFS="$(jq '[.records[].refs[]] | length' "$RECORD_FILE")"
SUMMARIES="$(jq -r '[.records[].expandedSummary] | join("\n")' "$RECORD_FILE")"

# The harness's core promise: whatever a reference pulled is present unchanged.
# Checked against the conversation's own text — every text part the model
# emitted, plus the prompt — so it holds whatever the model happened to write
# and whichever entry it chose to reference. Only meaningful if it referenced
# anything at all.
if [ "$REFS" -gt 0 ]; then
    COPIED="$(jq -rn \
        --argjson candidates "$(jq -s '[.[] | select(.type=="text") | .part.text]' "$TRIM")" \
        --arg prompt "$TRIM_PROMPT" \
        --arg summaries "$SUMMARIES" \
        '[($candidates[], $prompt) | select(. != "" and ($summaries | contains(.))) | length] | max // 0')"
    check "pulled content survives byte-for-byte" \
        "$([ "$COPIED" -ge 25 ] && echo yes || echo no)" \
        "longest verbatim span: $COPIED bytes"
else
    say "  ----  references not used by this model — verbatim check not applicable"
fi

# --- 3. the loop shield ------------------------------------------------------

say ""
say "[3/3] re-trim is refused"

# #1 is the summary the last scenario wrote, so this must bounce. Retried for
# the same reason as scenario 2: a model that never makes the call proves
# nothing either way, and that is a different failure from a shield that let
# the call through.
retried=0
refused=no
attempted=no
while [ "$retried" -lt "$ATTEMPTS" ]; do
    retried=$((retried + 1))
    RETRY="$SANDBOX/retry-$retried.json"
    run_opencode "$RETRY" --session "$SESSION" 'Call the trim-context tool with start set to "#1" and summary set to "retry" and next set to "report the response". Then report the tool'"'"'s exact response.'
    grep -q '"start":"#1"' "$RETRY" && attempted=yes
    if grep -q "is a \[summary\] entry" "$RETRY"; then
        refused=yes
        break
    fi
    [ "$retried" -lt "$ATTEMPTS" ] && say "  ....  attempt $retried: no refusal seen — retrying"
done

if [ "$refused" = yes ]; then
    check "re-trimming the same start is rejected" yes "attempt $retried of $ATTEMPTS"
elif [ "$attempted" = no ]; then
    check "re-trimming the same start is rejected" no "the model never made the call in $ATTEMPTS attempts (model compliance, not the shield)"
else
    check "re-trimming the same start is rejected" no "the call went through without the [summary] entry refusal"
fi

AFTER="$(jq '.records | length' "$RECORD_FILE")"
check "the refused trim wrote nothing" \
    "$([ "$AFTER" = "$RECORDS" ] && echo yes || echo no)" \
    "$RECORDS → $AFTER records"

# --- stats -------------------------------------------------------------------

stat_line "model" "$MODEL"
stat_line "attempts needed" "$attempt of $ATTEMPTS"
stat_line "trim-context calls" "$CALLS ($RECORDS of them trimmed)"
# More than one trim per run is the post-trim re-trim this scenario never asks for.
stat_line "trims attempted" "$(jq -r 'select(.type=="tool_use") | select(.part.tool=="trim-context") | .part.state.input.start // empty' "$TRIM" | wc -l)"
stat_line "references used" "$(jq -r '[.records[].refs[].ref] | if length == 0 then "none (fell back to prose)" else join(", ") end' "$RECORD_FILE")"
stat_line "summary size" "${#SUMMARIES} bytes"

# Context actually fed to the model per step — uncached input plus cache reads,
# since a cached token is still a token in the window. Reported as a series,
# not as a before/after saving: this scenario is a handful of messages long, so
# the summary is about as big as what it replaced. It demonstrates mechanics,
# never economics.
stat_line "context fed per step" "$(tokens_of "$TRIM" | jq -rs 'map(.input + .cache.read | tostring) | join(" → ")')"

say ""
say "stats"
printf '%s\n' "${STATS[@]}"

say ""
if [ "$failed" -eq 0 ]; then
    printf '\033[32m%d passed\033[0m, %d failed\n' "$passed" "$failed"
else
    printf '%d passed, \033[31m%d failed\033[0m\n' "$passed" "$failed"
fi
exit $((failed > 0))
