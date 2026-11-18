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


schema=ROOT/'operations/salary-statements-schema.sql'
installed=query("select to_regprocedure('public.salary_statement_report(uuid)') is not null as installed")[0]['installed']
if not installed:
 before="""begin;set local statement_timeout='60s';
select id from public.guilds where slug='xd' for update;
create temporary table salary_schema_guard(name text primary key,digest text) on commit drop;
do $guard$ declare t text;h text;g uuid;begin
select id into g from public.guilds where slug='xd';
foreach t in array array['treasury_payouts','treasury_sales','treasury_awards','treasury_allocations','treasury_loot','events','attendance','period_archives','activity_archives','payroll_batches','salary_payment_requests','memberships'] loop
execute format($q$select md5(coalesce(jsonb_agg(to_jsonb(x)-'guild_joined_on'-'guild_join_version' order by (to_jsonb(x)-'guild_joined_on'-'guild_join_version')::text),'[]'::jsonb)::text) from public.%I x where guild_id=$1$q$,t) into h using g;
insert into salary_schema_guard values(t,h);
end loop;
insert into salary_schema_guard values('current_quotes',md5((private.lifetime_payroll(g)->'rows')::text));
end $guard$;
"""
 after="""
do $guard$ declare t text;h text;g uuid;begin
select id into g from public.guilds where slug='xd';
foreach t in array array['treasury_payouts','treasury_sales','treasury_awards','treasury_allocations','treasury_loot','events','attendance','period_archives','activity_archives','payroll_batches','salary_payment_requests','memberships'] loop
execute format($q$select md5(coalesce(jsonb_agg(to_jsonb(x)-'guild_joined_on'-'guild_join_version' order by (to_jsonb(x)-'guild_joined_on'-'guild_join_version')::text),'[]'::jsonb)::text) from public.%I x where guild_id=$1$q$,t) into h using g;
if h is distinct from(select digest from salary_schema_guard where name=t) then raise exception 'SOURCE_DATA_CHANGED: %',t;end if;
end loop;
if md5((private.lifetime_payroll(g)->'rows')::text) is distinct from(select digest from salary_schema_guard where name='current_quotes') then raise exception 'EXISTING_QUOTES_CHANGED';end if;
if exists(select 1 from public.salary_statements) then raise exception 'UNEXPECTED_AUTOMATIC_STATEMENT';end if;
if exists(select 1 from public.memberships where guild_id=g and guild_joined_on is not null) then raise exception 'INVENTED_GUILD_DATE';end if;
end $guard$;
select true as financial_history_and_attendance_preserved,true as no_actual_payments_or_statements_created,true as existing_salary_quotes_unchanged;
commit;
"""
 print('SALARY_STATEMENT_SCHEMA_GUARDS',json.dumps(query(before+schema.read_text()+after)),flush=True)
checks=query("""select
 not has_table_privilege('authenticated','public.salary_statements','select') as snapshot_private,
 (select relrowsecurity from pg_class where oid='public.salary_statements'::regclass) as snapshot_rls,
 not has_function_privilege('anon','public.lock_salary_statement(uuid,text)','execute') as anonymous_lock_denied,
 has_function_privilege('authenticated','public.lock_salary_statement(uuid,text)','execute') as authenticated_lock_available,
 not has_function_privilege('authenticated','public.record_activity_before_salary_history(uuid,jsonb)','execute') as original_mutation_private,
 not has_function_privilege('authenticated','private.live_payroll_before_statements(uuid)','execute') as raw_calculation_private,
 not has_column_privilege('authenticated','public.memberships','guild_joined_on','update') as direct_date_mutation_denied,
 exists(select 1 from pg_trigger where tgname='salary_locked_payout') as committed_money_guard
""")
assert all(checks[0].values()),checks
print('SALARY_STATEMENT_SCHEMA_ACL_VERIFIED',flush=True)
preview=query("""begin read only;set local statement_timeout='20s';
with started as materialized(select clock_timestamp() t),calc as materialized(select private.lifetime_payroll(g.id) r from public.guilds g cross join started where slug='xd')
select round(extract(epoch from(clock_timestamp()-(select t from started)))*1000) calculation_ms,
jsonb_array_length(r->'rows') as members,(r->'statement'='null'::jsonb) as calculation_open,
(select count(*) from public.salary_statements) as statement_count,
(select count(*) from public.memberships where guild_joined_on is not null) as confirmed_guild_dates
from calc;rollback;""")
print('SALARY_STATEMENT_LIVE_READ_ONLY_PREVIEW',json.dumps(preview),flush=True)
