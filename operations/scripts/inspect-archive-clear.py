"""Apply the additive activity workspace schema to the verified live project."""
import os,json,re,subprocess,urllib.parse,urllib.request,urllib.error,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[2]
SSH=['ssh','-i',os.path.expanduser('~/.ssh/xd_operations'),'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=20','root@200.165.236.194']
remote='app=$(systemctl show xd-guild --property=WorkingDirectory --value); cd "$app"; node'
source="require('@next/env').loadEnvConfig(process.cwd());console.log(JSON.stringify({origin:process.env.APP_ORIGIN,url:process.env.NEXT_PUBLIC_SUPABASE_URL}));"
result=subprocess.run(SSH+[remote],input=source,text=True,capture_output=True,timeout=45,check=True)
target=json.loads(result.stdout);assert target['origin']=='https://xd-guild.ru'
url=urllib.parse.urlsplit(target['url']);ref=url.hostname.removesuffix('.supabase.co')
assert url.scheme=='https' and url.hostname.endswith('.supabase.co') and re.fullmatch('[a-z0-9]{20}',ref)
def query(sql):
 req=urllib.request.Request('https://api.supabase.com/v1/projects/'+ref+'/database/query',data=json.dumps({'query':sql}).encode(),headers={'Authorization':'Bearer '+os.environ['SUPABASE_ACCESS_TOKEN'],'Content-Type':'application/json'},method='POST')
 try:
  with urllib.request.urlopen(req,timeout=90) as response:return json.load(response)
 except urllib.error.HTTPError as e:
  print('SUPABASE_SQL_HTTP_ERROR',e.code,flush=True)
  try: print('SQL_DIAGNOSTIC',json.loads(e.read()).get('message','')[:800],flush=True)
  except Exception: pass
  raise SystemExit(1)


rows=query("""begin read only;set local statement_timeout='20s';
with target as (select e.id,e.starts_at from public.events e where e.guild_id=(select id from public.guilds where slug='xd') and e.activity_archive_id is not null and e.deleted_at is null),
loot as(select l.id from public.treasury_loot l join target t on t.id=l.event_id),sales as(select s.id from public.treasury_sales s join loot l on l.id=s.loot_id)
select (select count(*) from target) as archived_activities,
(select count(*) from public.events where guild_id=(select id from public.guilds where slug='xd') and activity_archive_id is null and deleted_at is null and not inventory_receipt) as current_activities,
(select count(*) from loot) as linked_inventory_rows,(select count(*) from sales) as linked_sales,
(select count(*) from target t join public.period_archives a on a.guild_id=(select id from public.guilds where slug='xd') and a.period_from=private.period_start((t.starts_at at time zone 'UTC')::date)) as closed_period_events;
rollback;""")
print('ARCHIVE_DELETE_READ_ONLY_PREVIEW',json.dumps(rows),flush=True)
