# shellcheck shell=bash disable=SC2034  # its variables are for the sourcing script
#
# Shared by the e2e scripts; sourced, never run. Sets up a sandbox for a real
# opencode and a real model: its own XDG_CONFIG_HOME (so the only plugin loaded
# is the bundle under test — none of the operator's global plugins, agents or
# rules) and its own XDG_DATA_HOME (so the trim records read back are this
# run's and nothing else). Credentials are the one thing borrowed from the real
# profile, by symlink rather than copy.
#
# Expects MODEL set. Provides SANDBOX, WORK, RECORD_DIR, say, check, finish and
# run_opencode.
#
#   KEEP=1          keep the sandbox for inspection instead of deleting
#   STEP_TIMEOUT=N  seconds one opencode run may take (default 600)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE="$ROOT/dist/index.js"

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

# Prints the scorecard and exits with it.
finish() {
    say ""
    if [ "$failed" -eq 0 ]; then
        printf '\033[32m%d passed\033[0m, %d failed\n' "$passed" "$failed"
    else
        printf '%d passed, \033[31m%d failed\033[0m\n' "$passed" "$failed"
    fi
    exit $((failed > 0))
}

for tool in opencode jq; do
    command -v "$tool" >/dev/null 2>&1 || {
        say "missing required tool: $tool"
        exit 127
    }
done

[ -f "$BUNDLE" ] || {
    say "no bundle at dist/index.js — run 'just build' first"
    exit 1
}

# `timeout` is coreutils; macOS ships it as gtimeout, or not at all. A missing
# one is not worth failing over — the run just has no ceiling.
if command -v timeout >/dev/null 2>&1; then
    TIMEOUT=(timeout "${STEP_TIMEOUT:-600}")
elif command -v gtimeout >/dev/null 2>&1; then
    TIMEOUT=(gtimeout "${STEP_TIMEOUT:-600}")
else
    TIMEOUT=()
fi

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/octrimmer-$(basename "$0" .sh)-XXXXXX")"
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

say ""
say "octrimmer $(basename "$0" .sh) — $MODEL"
say "sandbox: $SANDBOX"
say ""

# One `opencode run` in the sandbox, its JSON event stream written to OUT.
run_opencode() {
    local out="$1"
    shift
    (
        cd "$WORK"
        XDG_CONFIG_HOME="$CONFIG" XDG_DATA_HOME="$DATA" \
            "${TIMEOUT[@]}" opencode run "$@" -m "$MODEL" --format json
    ) >"$out" 2>"$out.err" || true
    # A provider refusal (region lock, quota, auth) would otherwise read as
    # the plugin failing the next check. Name it and stop.
    local error
    error="$(jq -r 'select(.type=="error") | .error.data.message // .error.name' "$out" | head -1)"
    if [ -n "$error" ]; then
        say "provider error on $MODEL: $error"
        say "pick another model: just $(basename "$0" .sh) provider/model"
        exit 1
    fi
}

session_of() { jq -r 'select(.sessionID) | .sessionID' "$1" | head -1; }
