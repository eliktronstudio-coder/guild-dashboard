#!/usr/bin/env bash
set -euo pipefail
[ "$(id -u)" = 0 ]
[ -f /etc/xd-guild/deploy.env ]
cat > /etc/systemd/system/xd-guild-backup.service <<'UNIT'
[Unit]
Description=Encrypted offsite XD database backup
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
UMask=0077
EnvironmentFile=/etc/xd-guild/deploy.env
ExecStart=/usr/bin/flock -w 1800 /var/lib/xd-guild-deploy/lock /usr/bin/python3 /var/www/xd-guild-command-center/scripts/database-release.py backup
TimeoutStartSec=1800
UNIT
cat > /etc/systemd/system/xd-guild-backup.timer <<'UNIT'
[Unit]
Description=Daily XD database backup
[Timer]
OnCalendar=*-*-* 01:00:00 UTC
Persistent=true
RandomizedDelaySec=15min
[Install]
WantedBy=timers.target
UNIT
install -d -m 700 /var/lib/xd-guild-deploy
systemctl daemon-reload
# First verify real backup upload; do not enable a broken schedule.
systemctl start xd-guild-backup.service
systemctl enable --now xd-guild-backup.timer
