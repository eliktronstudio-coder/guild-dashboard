#!/usr/bin/env bash
set -euo pipefail
umask 022
repo=/var/www/xd-guild-command-center
branch=codex/xd-foundation-20261031
state=/var/lib/xd-guild-deploy
mkdir -p "$state"
exec 9>"$state/lock"
flock -n 9 || exit 0
cd "$repo"
git diff --quiet
git diff --cached --quiet
[ "$(git branch --show-current)" = "$branch" ]
git fetch origin "$branch"
git merge --ff-only "origin/$branch"
revision=$(git rev-parse HEAD)
[ "$(cat "$state/deployed" 2>/dev/null || true)" != "$revision" ] || exit 0
bash scripts/deploy-timeweb.sh
printf '%s\n' "$revision" > "$state/deployed"
