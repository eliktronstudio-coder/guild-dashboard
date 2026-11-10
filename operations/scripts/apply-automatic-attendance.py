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


state=query("select to_regprocedure('private.complete_saved_attendance(uuid)') is not null as migrated")
if not state[0]['migrated']:
 stats=query("select count(*)::int as reports from public.events where status='completed' and deleted_at is null and not inventory_receipt and starts_at<=now() and attendance_finalized_at is null")
 print('SAVED_REPORTS_TO_ACCOUNT_AUTOMATICALLY',stats[0]['reports'],flush=True)
 query((ROOT/'operations/automatic-attendance.sql').read_text());print('AUTOMATIC_ATTENDANCE_MIGRATION_031_APPLIED',flush=True)
checks=query("select not exists(select 1 from public.events where status='completed' and deleted_at is null and not inventory_receipt and starts_at<=now() and attendance_finalized_at is null) as completed_reports_ready,not has_function_privilege('authenticated','private.complete_saved_attendance(uuid)','execute') as internal_helper_private,not has_function_privilege('authenticated','public.mark_attendance_before_automatic_count(uuid,uuid,integer,text,text)','execute') as legacy_entry_private")
assert len(checks)==1 and all(checks[0].values())
print('AUTOMATIC_ATTENDANCE_READY_WITH_PRIVATE_HELPERS',flush=True)
