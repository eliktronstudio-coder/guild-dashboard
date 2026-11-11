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

state=query("select position('from unnest(selected) x on conflict do nothing;' in pg_get_functiondef('private.apply_activity_details(uuid,jsonb,text)'::regprocedure))>0 migrated")
if not state[0]['migrated']:
 signature="select (select count(*) from public.memberships) memberships,(select count(*) from public.events) events,(select count(*) from public.attendance) attendance,(select count(*) from public.treasury_loot) stock,(select count(*) from public.treasury_sales) sales,(select count(*) from public.treasury_payouts) payouts,(select count(*) from public.period_archives) archives"
 before=query(signature)
 query((ROOT/'operations/activity-registration-date.sql').read_text())
 assert before==query(signature)
 print('HISTORICAL_ROSTER_SAVE_FIX_APPLIED_WITH_EXISTING_RECORDS_PRESERVED',flush=True)
checks=query("select position($needle$m.status='active' and m.joined_at<=e.starts_at$needle$ in pg_get_functiondef('private.apply_activity_details(uuid,jsonb,text)'::regprocedure))=0 registration_guard_removed,position('from unnest(selected) x on conflict do nothing;' in pg_get_functiondef('private.apply_activity_details(uuid,jsonb,text)'::regprocedure))>0 selected_members_snapshotted,not has_function_privilege('authenticated','private.apply_activity_details(uuid,jsonb,text)','execute') helper_private,exists(select 1 from pg_trigger where tgname='closed_attendance' and tgenabled='O') archives_protected")
assert len(checks)==1 and all(checks[0].values())
print('REGISTRATION_DATE_INDEPENDENT_ROSTERS_AND_CLOSED_PERIOD_GUARDS_VERIFIED',flush=True)
