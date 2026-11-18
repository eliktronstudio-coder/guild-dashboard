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
  print('SUPABASE_SQL_HTTP_ERROR',e.code,flush=True)
  try: print('SQL_DIAGNOSTIC',json.loads(e.read()).get('message','')[:800],flush=True)
  except Exception: pass
  raise SystemExit(1)


rows=query("""begin read only;set local statement_timeout='30s';
with started as materialized(select clock_timestamp() at), calc as materialized(select private.lifetime_payroll(g.id) r from public.guilds g cross join started where slug='xd')
select round(extract(epoch from(clock_timestamp()-(select at from started)))*1000) as calculation_ms,
 (select count(*) from jsonb_array_elements(r->'rows') v where (v->>'prime_eligible')::boolean) as prime_eligible,
 (select count(*) from jsonb_array_elements(r->'rows') v where (v->>'mini_eligible')::boolean) as mini_eligible,
 (select jsonb_agg(v-'available'-'present') from jsonb_array_elements(r->'rows') v where lower(v->>'nickname')='yomayow') as verified_player
from calc;rollback;""")
print('LIVE_CATEGORY_SALARY_READ_ONLY_VERIFIED',json.dumps(rows,ensure_ascii=False),flush=True)
