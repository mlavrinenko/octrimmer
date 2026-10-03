#!/usr/bin/env bash
#
# Cut a release from a green, pushed main: bump the version, commit and tag
# it, show what goes out, and on `y` push the tag. CI publishes the tag to npm
# (.github/workflows/release.yml); this waits for that run and confirms the
# run to pass. Declining undoes the bump.
#
#   just ship patch|minor|major|X.Y.Z

set -euo pipefail

die() { echo "ship: $*" >&2; exit 1; }

level=${1:?usage: just ship patch|minor|major|X.Y.Z}

[ "$(git branch --show-current)" = main ] || die "not on main"
[ -z "$(git status --porcelain)" ] || die "the working tree is not clean"
git fetch -q origin main --tags
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "main and origin/main differ; pull or push first"
prev=$(git describe --tags --abbrev=0 --match 'v*')
[ "$(git rev-list --count "$prev..HEAD")" -gt 0 ] || die "nothing to release since $prev"

just check

# Bumps package.json and package-lock.json, commits, tags.
npm version "$level" --message 'chore: release v%s' >/dev/null
tag="v$(jq -r .version package.json)"

echo "$prev -> $tag"
bash scripts/notes.sh "$tag"
read -rp "Push $tag and publish it to npm? [y/N] " answer
if [ "$answer" != y ]; then
    git tag -d "$tag" >/dev/null
    git reset -q --hard HEAD~1
    die "declined; the bump is undone"
fi

git push -q --atomic origin main "$tag"

sha=$(git rev-parse HEAD)
for _ in $(seq 30); do
    run=$(gh run list --workflow release.yml --commit "$sha" --limit 1 --json databaseId --jq '.[0].databaseId // empty')
    [ -n "$run" ] && break
    sleep 2
done
[ -n "${run:-}" ] || die "no release run appeared for $tag; see https://github.com/mlavrinenko/octrimmer/actions"
gh run watch "$run" --exit-status --compact >/dev/null || die "release run failed: gh run view $run --log-failed"
echo "published: https://www.npmjs.com/package/octrimmer/v/${tag#v}"
