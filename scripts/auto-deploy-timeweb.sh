#!/usr/bin/env bash
set -euo pipefail
umask 077
# Timer invocations have no SHA and never install an unchecked revision.
[ "$#" = 1 ] || { echo 'Deployment requires a commit approved by CI.'; exit 0; }
[[ "$1" =~ ^[0-9a-f]{40}$ ]] || exit 1
repo=/var/www/xd-guild-command-center
branch=codex/xd-foundation-20261031
state=/var/lib/xd-guild-deploy
mkdir -p "$state"
exec 9>"$state/lock"
flock -w 1800 9
cd "$repo"
git diff --quiet
git diff --cached --quiet
[ "$(git branch --show-current)" = "$branch" ]
git fetch origin "$branch"
# A stale workflow cannot downgrade or deploy a commit outside the live branch.
[ "$(git rev-parse "origin/$branch")" = "$1" ]
git merge --ff-only "$1"
[ "$(cat "$state/deployed" 2>/dev/null || true)" != "$1" ] || exit 0
[ -f /etc/xd-guild/deploy.env ]
[ "$(stat -c %u /etc/xd-guild/deploy.env)" = 0 ]
[ "$(stat -c %a /etc/xd-guild/deploy.env)" = 600 ]
set -a
source /etc/xd-guild/deploy.env
set +a
python3 scripts/database-release.py migrate
bash scripts/deploy-timeweb.sh
printf '%s\n' "$1" > "$state/deployed"
