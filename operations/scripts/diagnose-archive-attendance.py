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


statements=[
("ARCHIVES", "select date_from,date_through,event_count,created_at from public.activity_archives order by created_at desc limit 5"),
("EVENT_COUNTS", "select activity_archive_id is not null as archived,status,counts_for_attendance,count(*) as events,min(starts_at) as first_at,max(starts_at) as last_at from public.events where guild_id=(select id from public.guilds where slug='xd') and deleted_at is null and not inventory_receipt and starts_at<=now() group by 1,2,3 order by 1,2"),
("LIVE_ATTENDANCE", "select max(total_count) as total,max(prime_total_count) as prime,max(mini_total_count) as mini,sum(prime_present_weight) as prime_present_weight,sum(mini_present_weight) as mini_present_weight from private.weighted_attendance_event_counts((select id from public.guilds where slug='xd'),'-infinity','infinity')"),
("PAYROLL", "with c as(select private.lifetime_payroll(id) r from public.guilds where slug='xd') select r->'statement' as statement,count(*) filter(where (v->>'prime_percentage')::numeric>0) as nonzero_prime,count(*) filter(where (v->>'mini_percentage')::numeric>0) as nonzero_mini from c cross join jsonb_array_elements(r->'rows') v group by r->'statement'")]
for label,sql in statements:
 print(label,json.dumps(query("begin read only;set local statement_timeout='20s';"+sql+";rollback;")),flush=True)
