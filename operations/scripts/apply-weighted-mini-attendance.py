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


migration=ROOT/'operations/weighted-mini-attendance.sql'
exists=query("select to_regprocedure('private.weighted_attendance_event_counts(uuid,timestamptz,timestamptz)') is not null as installed")[0]['installed']
if not exists:
 sql=migration.read_text().strip();assert sql.startswith('begin;') and sql.endswith('commit;')
 core=sql[len('begin;'):-len('commit;')]
 guard_before="""begin;set local statement_timeout='45s';
select id from public.guilds where slug='xd' for update;
create temporary table weighted_data_guard(name text primary key,digest text) on commit drop;
do $guard$ declare t text;h text;g uuid;begin
 select id into g from public.guilds where slug='xd';
 foreach t in array array['treasury_payouts','treasury_sales','treasury_awards','events','attendance','period_archives','activity_archives'] loop
 execute format($q$select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb)::text) from public.%I x where guild_id=$1$q$,t) into h using g;
 insert into weighted_data_guard values(t,h);
 end loop;
end $guard$;
"""
 guard_after="""
do $guard$ declare t text;h text;g uuid;begin
 select id into g from public.guilds where slug='xd';
 foreach t in array array['treasury_payouts','treasury_sales','treasury_awards','events','attendance','period_archives','activity_archives'] loop
 execute format($q$select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb)::text) from public.%I x where guild_id=$1$q$,t) into h using g;
 if h is distinct from(select digest from weighted_data_guard where name=t) then raise exception 'SOURCE_DATA_CHANGED: %',t;end if;
 end loop;
end $guard$;
select true as source_facts_and_all_payments_preserved;
commit;
"""
 print('WEIGHTED_ATTENDANCE_MIGRATION',json.dumps(query(guard_before+core+guard_after)),flush=True)
checks=query("""select
 not has_function_privilege('authenticated','private.weighted_attendance_event_counts(uuid,timestamptz,timestamptz)','execute') as private_denied,
 not has_function_privilege('anon','public.all_time_attendance_report()','execute') as anon_denied,
 has_function_privilege('authenticated','public.all_time_attendance_report()','execute') as member_endpoint,
 position('live_categories_weighted_v2' in pg_get_functiondef('private.lifetime_payroll(uuid)'::regprocedure))>0 as salary_updated
""")
assert all(checks[0].values()),checks
print('WEIGHTED_ATTENDANCE_ACL_AND_SALARY_VERIFIED',flush=True)
rows=query("""begin read only;set local statement_timeout='20s';
with started as materialized(select clock_timestamp() t),calc as materialized(select private.lifetime_payroll(g.id) r from public.guilds g cross join started where slug='xd')
select round(extract(epoch from(clock_timestamp()-(select t from started)))*1000) calculation_ms,
 (select count(*) from jsonb_array_elements(r->'rows') v where (v->>'mini_eligible')::boolean) as mini_eligible,
 (select count(*) from jsonb_array_elements(r->'rows') v where (v->>'prime_eligible')::boolean) as prime_eligible,
 (select coalesce(sum((v->>'mini_projection')::numeric+(v->>'mini_fixed')::numeric),0)::text from jsonb_array_elements(r->'rows') v) as mini_due_units
from calc;rollback;""")
print('WEIGHTED_ATTENDANCE_LIVE_PREVIEW_NO_PAYOUTS_CREATED',json.dumps(rows),flush=True)
