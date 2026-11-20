#!/usr/bin/env bash
set -euo pipefail
umask 022
[ "$(id -u)" = 0 ]
repo=/var/www/xd-guild-command-center
[ -f "$repo/scripts/auto-deploy-timeweb.sh" ]
install -d -m 700 /var/lib/xd-guild-deploy
# Installation alone does not replace the currently running release.
if [ ! -f /var/lib/xd-guild-deploy/deployed ]; then
 git -C "$repo" rev-parse HEAD > /var/lib/xd-guild-deploy/deployed
fi
cat > /etc/systemd/system/xd-guild-deploy.service <<'UNIT'
[Unit]
Description=Deploy published XD Guild changes
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/bin/bash /var/www/xd-guild-command-center/scripts/auto-deploy-timeweb.sh
TimeoutStartSec=1800
UNIT
cat > /etc/systemd/system/xd-guild-deploy.timer <<'UNIT'
[Unit]
Description=Check XD Guild updates every two minutes
[Timer]
OnBootSec=2min
OnUnitInactiveSec=2min
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now xd-guild-deploy.timer
systemctl is-active xd-guild-deploy.timer
