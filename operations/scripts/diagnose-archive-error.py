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




rows=query("begin read only;select r.rolname, setting from pg_roles r cross join lateral unnest(coalesce(r.rolconfig,array[]::text[])) setting where r.rolname in ('authenticated','anon','authenticator') and setting like 'statement_timeout=%';rollback;")
print('ROLE_QUERY_TIMEOUTS',json.dumps(rows),flush=True)
for name,sql in [
 ('PAYROLL_READ',"select jsonb_array_length(private.live_payroll_before_statements((select id from public.guilds where slug='xd'))->'rows')"),
 ('ATTENDANCE_SNAPSHOT',"select count(*) from private.weighted_attendance_event_counts((select id from public.guilds where slug='xd'),'2026-10-01','2026-11-15')")]:
 rows=query("begin read only;set local statement_timeout='30s';explain (analyze,format json) "+sql+";rollback;")
 plan=rows[0]['QUERY PLAN'][0]
 print('READ_ONLY_BENCHMARK',name,json.dumps({'execution_ms':plan.get('Execution Time')}),flush=True)
