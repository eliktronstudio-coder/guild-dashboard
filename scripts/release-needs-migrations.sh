#!/usr/bin/env bash
# Exit 0 when migrations changed, 1 when unchanged, 2 when history is unavailable.
set -euo pipefail
[ "$#" = 2 ] || exit 2
[[ "$1" =~ ^[0-9a-f]{40}$ && "$2" =~ ^[0-9a-f]{40}$ ]] || exit 2
git cat-file -e "$1^{commit}" 2>/dev/null || exit 2
git cat-file -e "$2^{commit}" 2>/dev/null || exit 2
if git diff --quiet "$1" "$2" -- apps/web/supabase/migrations/; then
 exit 1
else
 result=$?
 [ "$result" = 1 ] && exit 0
 exit 2
fi
