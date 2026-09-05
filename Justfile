set quiet := true

default: check

# Full gate. Green before every commit.
check: fmt-check lint typecheck test jscpd tasks-check

fmt-check:
    npm run format:check

lint:
    npm run lint

typecheck:
    npm run typecheck

test:
    npm test

# jscpd (the Rust port, packaged via qahq in flake.nix) fails on any
# duplicated block of >=50 tokens, naming both spans. Fix a finding by
# extracting a shared helper — never by shuffling tokens until the detector
# loses the scent.
jscpd:
    jscpd --no-tips -k 50 -f typescript --exit-code 1 index.ts lib tests

# Validate the mindtape task board.
tasks-check:
    mt check

build:
    npm run build
