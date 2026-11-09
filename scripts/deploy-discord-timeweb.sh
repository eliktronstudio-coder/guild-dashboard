#!/usr/bin/env bash
set -euo pipefail
umask 022
[ "$(id -u)" = 0 ]
repo=$(cd "$(dirname "$0")/.." && pwd)
node_bin=$(command -v node)
"$node_bin" --input-type=module -e "await import('node:sqlite')"
command -v tesseract >/dev/null
tesseract --list-langs 2>/dev/null | grep -qx rus
root=/var/www/xd-discord-bot
mkdir -p "$root" /var/www/xd-discord-releases
# Type=simple may return before systemd creates StateDirectory on the first start.
install -d -m 700 -o xd-discord -g xd-discord /var/lib/xd-discord-bot
revision=$(git -C "$repo" rev-parse HEAD)
release=/var/www/xd-discord-releases/${revision:0:7}-$(date +%Y%m%d%H%M%S)
mkdir -p "$release"
git -C "$repo" archive HEAD apps/discord-bot | tar -x -C "$release"
cd "$release/apps/discord-bot"
npm ci --omit=dev
npm test
"$node_bin" --check src/index.mjs
old=$(readlink -f "$root/current" || true)
ln -s "$release/apps/discord-bot" "$root/.next-current"
mv -Tf "$root/.next-current" "$root/current"
if ! systemctl restart xd-discord-bot; then
 if [ -n "$old" ]; then ln -s "$old" "$root/.rollback-current"; mv -Tf "$root/.rollback-current" "$root/current"; systemctl restart xd-discord-bot; fi
 exit 1
fi
systemctl is-active xd-discord-bot
printf '%s\n' "$revision" > /var/lib/xd-discord-bot/deployed
printf 'Discord worker release: %s\n' "$revision"
