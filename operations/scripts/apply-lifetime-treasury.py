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


migration=ROOT/'operations/lifetime-treasury-summary.sql'
exists=query("select to_regprocedure('public.treasury_lifetime_summary()') is not null as installed")[0]['installed']
if not exists:
 query(migration.read_text())
checks=query("select to_regprocedure('public.treasury_lifetime_summary()') is not null as installed,has_function_privilege('authenticated','public.treasury_lifetime_summary()','execute') as authenticated_allowed,not has_function_privilege('anon','public.treasury_lifetime_summary()','execute') as anonymous_denied")
assert all(checks[0].values()),checks
print('LIFETIME_TREASURY_RPC_INSTALLED_AND_ACL_VERIFIED',flush=True)

context="""begin read only;set local statement_timeout='12s';
select set_config('request.jwt.claims',(select jsonb_build_object('sub',m.user_id,'session_id',s.id)::text from public.memberships m join public.membership_roles mr on mr.membership_id=m.id join public.roles r on r.id=mr.role_id and r.code='owner' join auth.sessions s on s.user_id=m.user_id join public.profiles p on p.id=m.user_id and not p.blocked where m.status='active' and not exists(select 1 from public.revoked_sessions x where x.session_id=s.id) order by s.created_at desc limit 1),true);

"""
rows=query(context+"select public.treasury_summary()->>'prime_units' as current_prime,public.treasury_lifetime_summary()->>'prime_units' as lifetime_prime,public.treasury_lifetime_summary()->>'mini_units' as lifetime_mini,public.treasury_lifetime_summary()->>'guild_units' as lifetime_guild,public.treasury_lifetime_summary()->>'sales_count' as retained_sales;rollback;")
print('LIFETIME_TREASURY_READ_ONLY_VERIFIED',json.dumps(rows),flush=True)
