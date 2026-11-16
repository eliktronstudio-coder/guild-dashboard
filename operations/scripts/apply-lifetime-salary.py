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


migration=ROOT/'operations/lifetime-salary-payments.sql'
exists=query("select to_regprocedure('public.pay_lifetime_salary(uuid,uuid,text,text)') is not null as installed")[0]['installed']
if not exists:
 query(migration.read_text())
checks=query("""select
 to_regprocedure('public.lifetime_payroll_report()') is not null as report_installed,
 has_function_privilege('authenticated','public.pay_lifetime_salary(uuid,uuid,text,text)','execute') as staff_endpoint_available,
 not has_function_privilege('anon','public.pay_lifetime_salary(uuid,uuid,text,text)','execute') as anonymous_denied,
 not has_function_privilege('authenticated','private.lifetime_payroll(uuid)','execute') as private_calculation_denied,
 not has_table_privilege('authenticated','public.salary_payment_requests','select') as requests_private,
 (select relrowsecurity from pg_class where oid='public.salary_payment_requests'::regclass) as requests_rls
""")
assert all(checks[0].values()),checks
print('LIFETIME_SALARY_SCHEMA_AND_ACL_VERIFIED',flush=True)
rows=query("""begin read only;set local statement_timeout='15s';
with report as (select private.lifetime_payroll(id) r from public.guilds where slug='xd')
select jsonb_array_length(r->'rows') as members,
 (select count(*) from jsonb_array_elements(r->'rows') v where (v->>'eligible')::boolean) as eligible,
 r->>'prime_units' as prime_units,r->>'mini_units' as mini_units from report;
rollback;""")
print('LIFETIME_SALARY_READ_ONLY_PREVIEW',json.dumps(rows),flush=True)
