#!/usr/bin/env bash
#
# Release notes for TAG: the subjects of the commits since the previous
# version tag, the release commit itself left out. `just ship` previews them;
# .github/workflows/release.yml puts them on the GitHub release.
#
#   scripts/notes.sh v0.1.1

set -euo pipefail

tag=${1:?usage: scripts/notes.sh TAG}
range="$tag^"
if prev=$(git describe --tags --abbrev=0 --match 'v*' "$tag^" 2>/dev/null); then
    range="$prev..$tag^"
fi
git log --format='- %s' "$range"
