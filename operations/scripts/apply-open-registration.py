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
state=query("select to_regclass('private.email_registrations')::text as registrations,to_regclass('public.activity_reports')::text as reports")
assert state[0]['reports'], 'Unexpected target schema'
if not state[0]['registrations']:
 query((ROOT/'operations/open-registration.sql').read_text())
 print('OPEN_REGISTRATION_MIGRATION_APPLIED',flush=True)
else: print('OPEN_REGISTRATION_ALREADY_PRESENT_NO_REPLAY',flush=True)
checks=query("select to_regprocedure('public.complete_open_registration(text,text,boolean,boolean)')::text as enrollment,to_regprocedure('public.registration_login_email(text)')::text as login,has_function_privilege('authenticated','public.registration_login_email(text)','execute') as browser_email_access,has_function_privilege('service_role','public.registration_login_email(text)','execute') as server_email_access,has_function_privilege('anon','public.complete_open_registration(text,text,boolean,boolean)','execute') as anonymous_enrollment")
assert checks[0]['enrollment'] and checks[0]['login'] and not checks[0]['browser_email_access'] and checks[0]['server_email_access'] and not checks[0]['anonymous_enrollment']
print('OPEN_REGISTRATION_SCHEMA_VERIFIED',json.dumps(checks),flush=True)
