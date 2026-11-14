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

# One function replacement, preserving ACL; no player/activity/finance data changes.
query((ROOT/'operations/discord-member-aliases.sql').read_text())
checks=query("select pg_get_functiondef('public.discord_import_context(text,text,text,text)'::regprocedure) like '%c.archived_at is null%' as aliases, has_function_privilege('service_role','public.discord_import_context(text,text,text,text)','execute') as service_allowed, not has_function_privilege('anon','public.discord_import_context(text,text,text,text)','execute') as anon_denied, not has_function_privilege('authenticated','public.discord_import_context(text,text,text,text)','execute') as user_denied")
assert len(checks)==1 and all(checks[0].values())
print('LIVE_DISCORD_CATALOG_ALIASES_AND_UNCHANGED_ACL_VERIFIED',flush=True)
