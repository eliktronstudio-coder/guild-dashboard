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
  print('SUPABASE_SQL_HTTP_ERROR',e.code,e.read().decode()[:1500],flush=True);raise SystemExit(1)

exists=query("select to_regprocedure('private.attendance_event_counts(uuid,timestamp with time zone,timestamp with time zone)') is not null as installed")[0]['installed']
if not exists:
 query((ROOT/'operations/reference-attendance.sql').read_text())
 print('REFERENCE_ATTENDANCE_MIGRATION_APPLIED_FINANCE_AND_ARCHIVE_HASHES_UNCHANGED',flush=True)
else:print('REFERENCE_ATTENDANCE_MIGRATION_ALREADY_INSTALLED',flush=True)
checks=query("""select private.attendance_bucket('АГЛ Т2','pve')='mini_rb' and private.attendance_bucket('АГЛ','pvp')='prime' and private.attendance_bucket('Кошка','pve')='mini_rb' as reference_categories,
 not exists(select 1 from private.attendance_event_counts((select id from public.guilds where slug='xd'),now()-interval '31 days',now()) c where c.total_count<>c.prime_total_count+c.mini_total_count or c.present_count>c.total_count or c.pvp_total_count>c.prime_total_count) as counts_consistent,
 (select count(distinct total_count)<=1 from private.attendance_event_counts((select id from public.guilds where slug='xd'),now()-interval '31 days',now())) as shared_denominator,
 not has_function_privilege('anon','public.attendance_category_report(timestamp with time zone,timestamp with time zone)','execute') as anonymous_denied""")
assert len(checks)==1 and all(checks[0].values()),checks
print('LIVE_REFERENCE_ATTENDANCE_CHECKS',json.dumps(checks[0]),flush=True)
