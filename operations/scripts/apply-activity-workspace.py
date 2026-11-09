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
state=query("select to_regclass('public.activity_reports')::text as reports,to_regclass('public.guild_activity_banners')::text as banners,to_regclass('public.guild_drop_registry')::text as drops")
assert state[0]['banners'] and state[0]['drops'], 'Catalog prerequisite missing'
if not state[0]['reports']:
 query((ROOT/'operations/activity-workspace.sql').read_text())
 print('ACTIVITY_WORKSPACE_MIGRATION_APPLIED',flush=True)
else: print('ACTIVITY_WORKSPACE_ALREADY_PRESENT_NO_REPLAY',flush=True)
checks=query("select to_regprocedure('public.activity_journal(timestamp with time zone,timestamp with time zone,jsonb,integer)')::text as journal,to_regprocedure('public.activity_detail(uuid)')::text as detail,(select relrowsecurity from pg_class where oid='public.activity_evidence'::regclass) as evidence_rls,(select count(*) from public.guild_activity_banners) as banners,(select count(*) from public.guild_drop_registry) as drops")
assert checks[0]['journal'] and checks[0]['detail'] and checks[0]['evidence_rls']
print('ACTIVITY_WORKSPACE_SCHEMA_VERIFIED',json.dumps(checks),flush=True)
