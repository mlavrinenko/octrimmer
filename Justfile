set quiet := true

default: check

# Full gate. Green before every commit. `e2e` is deliberately out: it spends
# real model calls and needs credentials.
check: fmt-check lint shellcheck typecheck test jscpd tasks-check

fmt-check:
    npx prettier --check --log-level warn .

lint:
    npm run -s lint

shellcheck:
    shellcheck scripts/*.sh

typecheck:
    npm run -s typecheck

test:
    npx vitest run --reporter=dot

# jscpd (the Rust port, packaged via qahq in flake.nix) fails on any
# duplicated block of >=50 tokens, naming both spans. Fix a finding by
# extracting a shared helper — never by shuffling tokens until the detector
# loses the scent.
jscpd:
    jscpd --no-tips -k 50 -f typescript --exit-code 1 -r ai index.ts lib tests

# Validate the mindtape task board.
tasks-check:
    mt check

build:
    npm run build

# Sandboxed: its own config and data homes, so neither your plugins nor your
# sessions take part. Costs a few model calls, so it is not part of `check`.
#
#   just e2e                             the default model
#   just e2e anthropic/claude-haiku-4-5  a different one
#   KEEP=1 just e2e                      keep the sandbox to poke at
[doc("End-to-end check against a real opencode and a real model")]
e2e model="" *args: build
    MODEL="${MODEL:-{{ if model == "" { "opencode/space-bunny-free" } else { model } }}}" \
      bash scripts/e2e.sh {{ args }}
