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


state=query("select to_regprocedure('private.can_manage_activity_loot(uuid)') is not null as migrated")
if not state[0]['migrated']:
 query((ROOT/'operations/activity-roles.sql').read_text());print('ACTIVITY_ROLES_MIGRATION_029_APPLIED',flush=True)
roles=query("select code,name from public.roles where guild_id=(select id from public.guilds where slug='xd') and code in ('guild_master','tablemaker') order by code")
assert roles==[{'code':'guild_master','name':'Гильд мастер'},{'code':'tablemaker','name':'Таблицмейкер'}]
permissions=query("select rp.permission from public.role_permissions rp join public.roles r on r.id=rp.role_id where r.guild_id=(select id from public.guilds where slug='xd') and r.code='tablemaker' order by rp.permission")
assert [r['permission'] for r in permissions]==['activities.loot','attendance.manage','events.manage','members.read']
print('ACTIVITY_ROLES_READY_WITHOUT_ASSIGNING_USERS',flush=True)
