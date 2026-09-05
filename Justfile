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

# jscpd: refuse duplicated blocks of >=50 tokens. Fix by extracting a helper,
# never by shuffling tokens until the detector loses the scent.
jscpd:
    jscpd --silent --noTips -k 50 -f typescript --exitCode 1 index.ts lib tests

# Validate the mindtape task board.
tasks-check:
    mt check

build:
    npm run build
