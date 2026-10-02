set quiet := true

default: check

# The one gate. Green before every commit; its checks run in parallel, each
# silent when green and printing its whole report when red. `e2e` is
# deliberately out: it spends real model calls and needs credentials.
[parallel]
check: fmt-check lint knip shellcheck typecheck test jscpd tasks-check

fmt-check:
    npx prettier --check --log-level warn .

# Every rule at error, warnings denied: see .oxlintrc.json.
lint:
    out=$(npx oxlint --deny-warnings index.ts lib tests *.config.ts 2>&1) || { printf '%s\n' "$out"; exit 1; }

# Dead code: unused files, exports, types, class members and dependencies.
# Fix a finding by cutting, not by ignoring; knip.json carries the entries.
knip:
    out=$(npx knip 2>&1) || { printf '%s\n' "$out"; exit 1; }

shellcheck:
    shellcheck scripts/*.sh

typecheck:
    out=$(npx tsc 2>&1) || { printf '%s\n' "$out"; exit 1; }

# Silent when green; the full report only on failure.
test:
    out=$(npx vitest run --reporter=dot 2>&1) || { printf '%s\n' "$out"; exit 1; }

# jscpd (the Rust port, packaged via qahq in flake.nix) fails on any
# duplicated block of >=50 tokens, naming both spans. Fix a finding by
# extracting a shared helper — never by shuffling tokens until the detector
# loses the scent.
jscpd:
    out=$(jscpd --no-tips -k 50 -f typescript --exit-code 1 -r ai index.ts lib tests 2>&1) || { printf '%s\n' "$out"; exit 1; }

# Validate the mindtape task board.
tasks-check:
    mt check -q

build:
    npx tsup --silent

# Sandboxed: its own config and data homes, so neither your plugins nor your
# sessions take part. Costs a few model calls, so it is not part of `check`.
#
#   just e2e                             the first free model opencode offers
#   just e2e anthropic/claude-haiku-4-5  a different one
#   KEEP=1 just e2e                      keep the sandbox to poke at
[doc("End-to-end check against a real opencode and a real model")]
e2e model="" *args: build
    MODEL="${MODEL:-{{ model }}}" \
      bash scripts/e2e.sh {{ args }}
