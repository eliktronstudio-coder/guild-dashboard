#!/usr/bin/env bash
# Run as root from the updated checkout, after applying migrations 017 and 018.
set -euo pipefail
umask 022
repo=$(cd "$(dirname "$0")/.." && pwd)
[ "$(id -u)" = 0 ] || { echo 'Запустите от root.'; exit 1; }
service=/etc/systemd/system/xd-guild.service
old_app=$(systemctl show xd-guild --property=WorkingDirectory --value)
[ -f "$old_app/.env.local" ] && [ -f "$service" ]
git -C "$repo" diff --quiet
git -C "$repo" diff --cached --quiet
node_bin=$(command -v node)
case "$node_bin" in /usr/bin/node|/usr/local/bin/node) ;; *) echo 'Нужен системный Node.js.'; exit 1;; esac
# API reads only; never print keys or response bodies.
cd "$old_app"
node <<'JS'
require('@next/env').loadEnvConfig(process.cwd());
(async()=>{
 const e=process.env;
 if(!e.SUPABASE_SECRET_KEY) throw new Error('Не задан SUPABASE_SECRET_KEY.');
 for(const query of ['guild_catalog?select=id&limit=1','memberships?select=payout_weight,weight_version&limit=1','treasury_pools?select=id&limit=1']){
  const r=await fetch(e.NEXT_PUBLIC_SUPABASE_URL+'/rest/v1/'+query,{headers:{apikey:e.SUPABASE_SECRET_KEY},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error('Проверка базы не прошла. Примените миграции 017 и 018 и проверьте ключ Supabase.');
 }
 console.log('Новые таблицы и коэффициенты доступны.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
JS
release=/var/www/xd-guild-releases/$(git -C "$repo" rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)
mkdir -p "$release"
git -C "$repo" archive HEAD | tar -x -C "$release"
app=$release/apps/web
install -m 600 "$old_app/.env.local" "$app/.env.local"
cd "$app"
npm ci --include=dev
npm run build
chown xd-guild:xd-guild "$app/.env.local"
chown -R xd-guild:xd-guild "$app/.next"
runuser -u xd-guild -- test -r "$app/node_modules/next/dist/bin/next"
backup=$service.backup-$(date +%Y%m%d%H%M%S)
cp -a "$service" "$backup"
python3 - "$service" "$app" "$node_bin" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);lines=p.read_text().splitlines();counts={'WorkingDirectory':0,'ExecStart':0}
for i,line in enumerate(lines):
 if line.startswith('WorkingDirectory='):lines[i]='WorkingDirectory='+sys.argv[2];counts['WorkingDirectory']+=1
 if line.startswith('ExecStart='):lines[i]='ExecStart='+sys.argv[3]+' '+sys.argv[2]+'/node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3001';counts['ExecStart']+=1
if set(counts.values())!={1}:raise SystemExit('Неожиданный формат service; переключение отменено.')
p.write_text('\n'.join(lines)+'\n')
PY
rollback() {
 cp -a "$backup" "$service"
 systemctl daemon-reload
 systemctl restart xd-guild
 echo 'Проверка запуска не прошла. Возвращён предыдущий service.'
}
systemctl daemon-reload
if ! systemctl restart xd-guild; then rollback; exit 1; fi
if ! curl --fail --silent --show-error --retry 8 --retry-connrefused --retry-delay 2 --max-time 10 -o /dev/null http://127.0.0.1:3001/login; then rollback; exit 1; fi
systemctl is-active xd-guild
echo 'Обновление запущено. Откройте https://xd-guild.ru/admin и нажмите Ctrl+Shift+R.'
