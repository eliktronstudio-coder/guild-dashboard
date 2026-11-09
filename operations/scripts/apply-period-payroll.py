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

checks=[('202611090025_member_coefficients.sql',"select exists(select 1 from information_schema.columns where table_schema='public' and table_name='memberships' and column_name='payout_weight') as migrated"),
('202611090026_participation_claims.sql',"select to_regclass('public.participation_claims') is not null as migrated"),
('202611090027_chest_inventory.sql',"select to_regprocedure('public.add_registry_inventory(uuid,uuid,uuid,integer,text,bigint,integer,text)') is not null as migrated"),
('202611090028_period_payroll.sql',"select to_regprocedure('public.period_payroll_report(date)') is not null as migrated")]
ledger="select (select count(*) from public.memberships) as members,(select count(*) from public.treasury_sales) as sales,(select count(*) from public.treasury_payouts) as payouts,(select coalesce(sum(amount_units),0)::text from public.treasury_payouts) as paid,(select count(*) from public.treasury_awards) as awards"
before=query(ledger)
for name,probe in checks:
 if not query(probe)[0]['migrated']:
  query((ROOT/'operations/payroll-migrations'/name).read_text());print('APPLIED',name,flush=True)
 assert query(probe)[0]['migrated']
after=query(ledger);assert before==after,'Existing ledger changed during schema migration'
assert query("select not has_function_privilege('authenticated','public.allocate_treasury_sale(uuid,uuid,uuid[],text)','execute') as legacy_disabled,not has_table_privilege('anon','public.participation_claims','select') as claims_private,not has_function_privilege('authenticated','private.period_payroll(uuid,date)','execute') as internal_private")[0]=={'legacy_disabled':True,'claims_private':True,'internal_private':True}
print('PAYROLL_SCHEMA_READY_EXISTING_ACCOUNTS_AND_LEDGER_UNCHANGED',flush=True)
