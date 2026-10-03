#!/usr/bin/env bash
#
# End-to-end check against a real opencode and a real model.
#
# Sandboxed by scripts/e2e-sandbox.sh.
#
#   MODEL=provider/model  which model to drive (default: the first free one
#                         opencode offers — free models come and go, so none
#                         is pinned)
#   KEEP=1                keep the sandbox for inspection instead of deleting
#
# Exits non-zero if any assertion fails. Model-dependent behaviour (does it
# reach for references at all?) is reported as a statistic, not an assertion —
# a weaker model should read as a worse score, not as a broken plugin.

set -euo pipefail

declare -a STATS=()

stat_line() { STATS+=("$(printf '  %-22s %s' "$1" "$2")"); }

if [ -z "${MODEL:-}" ]; then
    MODEL="$(opencode models 2>/dev/null | grep -m1 '^opencode/.*-free$' || true)"
    [ -n "$MODEL" ] || {
        echo "no free opencode model on offer — pass MODEL=provider/model"
        exit 1
    }
fi

# shellcheck source=scripts/e2e-sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/e2e-sandbox.sh"

# --- event stream readers -----------------------------------------------------

texts() { jq -r 'select(.type=="text") | .part.text' "$1"; }
tool_calls() { jq -r --arg t "$2" 'select(.type=="tool_use") | select(.part.tool==$t) | .part.tool' "$1" | wc -l; }
tokens_of() { jq -c 'select(.type=="step_finish") | .part.tokens' "$1"; }
# Trim-context calls that tried to trim (carried a start), as opposed to listing.
trims_of() { jq -r 'select(.type=="tool_use") | select(.part.tool=="trim-context") | .part.state.input.start // empty' "$1" | wc -l; }
# Of those, the ones that went through rather than being refused.
trims_done() { jq -r 'select(.type=="tool_use") | select(.part.tool=="trim-context") | select(.part.state.status=="completed") | .part.state.input.start // empty' "$1" | wc -l; }
# References the completed trims wrote, one per line. Records keep only the
# expanded summary, so the written form is read back from the call itself.
refs_of() { jq -r 'select(.type=="tool_use") | select(.part.tool=="trim-context") | select(.part.state.status=="completed") | .part.state.input.summary // empty | scan("\\[\\[[^]]*\\]\\]")' "$1"; }

# --- 1. the tool reaches the model -------------------------------------------

say "[1/4] tool registration"
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
say "[2/4] trim with a verbatim reference"
# Every decision the prompt can make for the model, it makes: "#1" is the user
# turn, which is always a real message on a fresh session. What is left to the
# model is the part under test — composing a summary that references instead of
# restating. Small models still wander off, so the scenario is retried; the
# attempt count is reported, because needing three goes IS the finding.
TRIM_PROMPT='Do exactly three things, in order, and do not stop early.
1. Write a 4-line poem about rain.
2. Call the trim-context tool with no arguments and read the numbered list it returns.
3. Call trim-context a second time with start set to "#1" and summary set to one short sentence followed by a [[#N]] reference pointing at the entry that holds your poem, and actionRightAfterTrim set to "reply DONE".
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

REFS="$(refs_of "$TRIM" | wc -l)"
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
say "[3/4] re-trim is refused"

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
    run_opencode "$RETRY" --session "$SESSION" 'Call the trim-context tool with start set to "#1" and summary set to "retry" and actionRightAfterTrim set to "report the response". Then report the tool'"'"'s exact response.'
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

# --- 4. one trim per request --------------------------------------------------

say ""
say "[4/4] one trim per request"

# The reported bug: asked to trim, the model trimmed, then trimmed again. The
# region swallows the request and the call, so the next step sees only the
# summary. Unlike scenario 2 nothing is dictated — no positions, no "then reply"
# — because a scripted next step is exactly what hides the bug. Retried only
# when the model never trims; a second trim going through is the failure. One
# the guard refused is reported, not failed: the refusal is the plugin working.
ONCE_TRIMS=0
ONCE_REFUSED=0
once_try=0
while [ "$once_try" -lt "$ATTEMPTS" ]; do
    once_try=$((once_try + 1))
    WORKED="$SANDBOX/once-work-$once_try.json"
    ONCE="$SANDBOX/once-$once_try.json"
    run_opencode "$WORKED" "Write a 4-line poem about rain, then list three facts about clouds."
    run_opencode "$ONCE" --session "$(session_of "$WORKED")" "Trim your context now, keeping the poem."
    ONCE_TRIMS="$(trims_done "$ONCE")"
    ONCE_REFUSED=$(($(trims_of "$ONCE") - ONCE_TRIMS))
    [ "$ONCE_TRIMS" -gt 0 ] && break
    [ "$once_try" -lt "$ATTEMPTS" ] && say "  ....  attempt $once_try: the model did not trim — retrying"
done

if [ "$ONCE_TRIMS" -eq 0 ]; then
    check "a trim request trims once" no "the model never trimmed in $ATTEMPTS attempts (model compliance)"
else
    check "a trim request trims once" "$([ "$ONCE_TRIMS" -eq 1 ] && echo yes || echo no)" \
        "$ONCE_TRIMS trim(s) on attempt $once_try of $ATTEMPTS, $ONCE_REFUSED refused"
fi

# --- stats -------------------------------------------------------------------

stat_line "model" "$MODEL"
stat_line "attempts needed" "$attempt of $ATTEMPTS"
stat_line "trim-context calls" "$CALLS ($RECORDS of them trimmed)"
# More than one trim per run is the post-trim re-trim this scenario never asks for.
stat_line "trims attempted" "$(trims_of "$TRIM")"
stat_line "references used" "$(refs_of "$TRIM" | jq -Rrs 'split("\n") | map(select(. != "")) | if length == 0 then "none (fell back to prose)" else join(", ") end')"
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

finish
