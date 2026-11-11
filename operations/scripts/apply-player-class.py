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

state=query("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='memberships' and column_name='class_selected_at') migrated")
if not state[0]['migrated']:
 signature="select md5(coalesce((select jsonb_agg(to_jsonb(m)-'player_class'-'class_selected_at' order by id)::text from public.memberships m),'[]')) memberships,(select count(*) from public.events) events,(select count(*) from public.attendance) attendance,(select count(*) from public.treasury_loot) inventory,(select count(*) from public.treasury_sales) sales,(select count(*) from public.treasury_payouts) payouts"
 before=query(signature)
 query((ROOT/'operations/player-class.sql').read_text())
 assert query(signature)==before
 print('PLAYER_CLASS_SCHEMA_APPLIED_WITH_MEMBERSHIPS_AND_ACTIVITY_FINANCE_DATA_PRESERVED',flush=True)
query("notify pgrst,'reload schema'")
checks=query("select to_regprocedure('public.set_own_player_class(text)') is not null choice_rpc,to_regprocedure('public.complete_open_registration(text,text,boolean,boolean,text)') is not null enrollment_rpc,not has_function_privilege('authenticated','public.complete_open_registration_before_class(text,text,boolean,boolean)','execute') old_enrollment_private,not has_function_privilege('anon','public.set_own_player_class(text)','execute') anon_denied,not exists(select 1 from public.memberships where (player_class is null)<>(class_selected_at is null)) exact_selection_state")
assert len(checks)==1 and all(checks[0].values())
print('REQUIRED_CLASS_AND_ONE_TIME_SELECTION_SCHEMA_VERIFIED',flush=True)
counts=query("select count(*)::int existing_members,count(*) filter(where class_selected_at is null)::int will_be_prompted from public.memberships where status='active'")
print('PLAYER_CLASS_PROMPT_COUNTS',json.dumps(counts[0]),flush=True)
