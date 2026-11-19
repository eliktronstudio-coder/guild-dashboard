"""Restore the exact 218 previously removed archived activities to the current journal."""
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
  with urllib.request.urlopen(req,timeout=180) as response:return json.load(response)
 except urllib.error.HTTPError as e:
  print('SUPABASE_SQL_HTTP_ERROR',e.code,flush=True)
  try: print('SQL_DIAGNOSTIC',json.loads(e.read()).get('message','')[:800],flush=True)
  except Exception: pass
  raise SystemExit(1)


context="""select set_config('request.jwt.claims',(select jsonb_build_object('sub',m.user_id,'session_id',s.id)::text from public.memberships m join public.membership_roles mr on mr.membership_id=m.id join public.roles r on r.id=mr.role_id and r.code='owner' join auth.sessions s on s.user_id=m.user_id join public.profiles p on p.id=m.user_id and not p.blocked where m.status='active' and not exists(select 1 from public.revoked_sessions x where x.session_id=s.id) order by s.created_at desc limit 1),true);"""
sql=(ROOT/'operations/restore-activities-to-current.sql').read_text()
assert sql.startswith('begin;')
sql=sql.replace('begin;','begin;'+context,1)
print('ACTIVITIES_RESTORED_TO_CURRENT_VERIFIED',json.dumps(query(sql)),flush=True)
