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
  print('SUPABASE_SQL_HTTP_ERROR',e.code,flush=True);raise SystemExit(1)


migration=ROOT/'operations/activity-range-archive.sql'
exists=query("select to_regprocedure('public.archive_activities(uuid,date,date)') is not null as installed")[0]['installed']
if not exists:query(migration.read_text())
checks=query("""select
 has_function_privilege('authenticated','public.archive_activities(uuid,date,date)','execute') as authenticated_endpoint,
 not has_function_privilege('anon','public.archive_activities(uuid,date,date)','execute') as anonymous_denied,
 not has_column_privilege('authenticated','public.activity_archives','attendance_snapshot','select') as snapshot_private,
 not has_table_privilege('authenticated','private.current_events','select') as internal_view_private,
 (select relrowsecurity from pg_class where oid='public.activity_archives'::regclass) as archives_rls,
 exists(select 1 from pg_trigger where tgname='activity_archived_attendance') as archived_attendance_guard
""")
assert all(checks[0].values()),checks
print('ACTIVITY_ARCHIVE_SCHEMA_AND_ACL_VERIFIED_NO_ACTIVITIES_ARCHIVED',flush=True)
rows=query("""begin read only;select count(*) as archive_batches from public.activity_archives;rollback;""")
print('ARCHIVE_BATCH_COUNT_READ_ONLY',json.dumps(rows),flush=True)
