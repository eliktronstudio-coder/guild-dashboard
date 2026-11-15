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


signature="public.record_xd_service_sale(uuid,text,bigint,text,text)"
exists=query("select to_regprocedure('"+signature+"') is not null as installed")[0]['installed']
if not exists:
 query((ROOT/'operations/xd-service-sales.sql').read_text())
 print('XD_SERVICE_SALE_FUNCTION_INSTALLED_EXISTING_FINANCE_STOCK_ATTENDANCE_ARCHIVES_UNCHANGED',flush=True)
checks=query("select not has_function_privilege('anon','"+signature+"','execute') anonymous_denied,has_function_privilege('authenticated','"+signature+"','execute') authenticated_rpc,prosecdef as secure_rpc from pg_proc where oid='"+signature+"'::regprocedure")
assert len(checks)==1 and all(checks[0].values())
print('XD_SERVICE_SALES_RPC_PRIVILEGES_VERIFIED',flush=True)
