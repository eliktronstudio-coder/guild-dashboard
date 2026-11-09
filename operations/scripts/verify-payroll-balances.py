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


checks=query("with calc as (\n select private.period_payroll((select id from public.guilds where slug='xd'),(date_trunc('month',(now() at time zone 'UTC')-interval '14 days')+interval '14 days')::date) v\n), totals as (select v,coalesce((select sum((r->>'prime_projection')::numeric) from jsonb_array_elements(v->'rows') r),0) prime_sum,coalesce((select sum((r->>'mini_projection')::numeric) from jsonb_array_elements(v->'rows') r),0) mini_sum,(select count(*) from jsonb_array_elements(v->'rows') r where (r->>'eligible')::boolean) eligible from calc)\nselect (case when eligible>0 then prime_sum=(v->>'prime_units')::numeric and mini_sum=(v->>'mini_units')::numeric else prime_sum=0 and mini_sum=0 end) as exact_distribution,\n not exists(select 1 from jsonb_array_elements(v->'rows') r where not (r->>'eligible')::boolean and ((r->>'prime_projection')::numeric<>0 or (r->>'mini_projection')::numeric<>0)) as threshold_enforced,\n not exists(select 1 from jsonb_array_elements(v->'rows') r where (r->>'payout_weight')::integer not between 20 and 125) as coefficient_range\nfrom totals")
assert len(checks)==1 and all(checks[0].values())
print("LIVE_PAYROLL_EXACT_DISTRIBUTION_THRESHOLD_AND_COEFFICIENT_VERIFIED",flush=True)
