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


migration=ROOT/'operations/live-category-salary.sql'
exists=query("select to_regprocedure('public.recalculate_category_salary()') is not null as installed")[0]['installed']
if not exists:query(migration.read_text())
checks=query("""select
 has_function_privilege('authenticated','public.recalculate_category_salary()','execute') as endpoint,
 not has_function_privilege('anon','public.recalculate_category_salary()','execute') as anon_denied,
 not has_function_privilege('authenticated','private.release_live_salary_awards(uuid)','execute') as private_denied,
 not has_function_privilege('authenticated','public.void_treasury_sale_before_categories(uuid,text)','execute') as legacy_denied
""")
assert all(checks[0].values()),checks
print('CATEGORY_SALARY_SCHEMA_ACL_VERIFIED',flush=True)
context="""begin;set local statement_timeout='45s';
select set_config('request.jwt.claims',(select jsonb_build_object('sub',m.user_id,'session_id',s.id)::text from public.memberships m join public.membership_roles mr on mr.membership_id=m.id join public.roles r on r.id=mr.role_id and r.code='owner' join auth.sessions s on s.user_id=m.user_id join public.profiles p on p.id=m.user_id and not p.blocked where m.status='active' and not exists(select 1 from public.revoked_sessions x where x.session_id=s.id) order by s.created_at desc limit 1),true);
"""
repair="""
create temporary table repair_checks(name text primary key,digest text) on commit drop;
create temporary table repair_result(changed integer) on commit drop;
do $repair$
declare g uuid;t text;before_hash text;after_hash text;n integer;calc jsonb;p numeric;m numeric;
begin
 select id into g from public.guilds where slug='xd' for update;
 -- Every source fact and recorded payout must remain byte-for-byte unchanged.
 foreach t in array array['treasury_payouts','treasury_sales','treasury_loot','events','attendance','period_archives','activity_archives','payroll_batches','salary_payment_requests'] loop
  execute format($q$select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb)::text) from public.%I x where guild_id=$1$q$,t) into before_hash using g;
  insert into repair_checks values(t,before_hash);
 end loop;
 select md5(coalesce(jsonb_agg(to_jsonb(w) order by w.id),'[]')::text) into before_hash from public.treasury_awards w join public.treasury_allocations a on a.id=w.allocation_id where w.guild_id=g and not private.live_salary_sale(a.sale_id);
 insert into repair_checks values('protected_awards',before_hash);
 n:=public.recalculate_category_salary();
 if public.recalculate_category_salary()<>0 then raise exception 'REPAIR_NOT_IDEMPOTENT';end if;
 foreach t in array array['treasury_payouts','treasury_sales','treasury_loot','events','attendance','period_archives','activity_archives','payroll_batches','salary_payment_requests'] loop
  execute format($q$select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb)::text) from public.%I x where guild_id=$1$q$,t) into after_hash using g;
  if after_hash is distinct from (select digest from repair_checks where name=t) then raise exception 'SOURCE_FACT_CHANGED: %',t;end if;
 end loop;
 select md5(coalesce(jsonb_agg(to_jsonb(w) order by w.id),'[]')::text) into after_hash from public.treasury_awards w join public.treasury_allocations a on a.id=w.allocation_id where w.guild_id=g and not private.live_salary_sale(a.sale_id);
 if after_hash is distinct from (select digest from repair_checks where name='protected_awards') then raise exception 'HISTORICAL_AWARD_CHANGED';end if;
 calc:=private.lifetime_payroll(g);
 select sum((v->>'prime_projection')::numeric+(v->>'prime_fixed')::numeric),sum((v->>'mini_projection')::numeric+(v->>'mini_fixed')::numeric) into p,m from jsonb_array_elements(calc->'rows') v;
 if p>private.fund_balance(g,'prime') or m>private.fund_balance(g,'mini_rb') then raise exception 'QUOTE_EXCEEDS_CASH';end if;
 insert into repair_result values(n);
end $repair$;
select (select changed from repair_result) as recalculated_awards,
 (select jsonb_agg(jsonb_build_object('nickname',v->>'nickname','prime_percentage',v->'prime_percentage','mini_percentage',v->'mini_percentage','prime_eligible',v->'prime_eligible','mini_eligible',v->'mini_eligible',
 'prime_due_units',((v->>'prime_projection')::numeric+(v->>'prime_fixed')::numeric)::text,'mini_due_units',((v->>'mini_projection')::numeric+(v->>'mini_fixed')::numeric)::text,'prime_paid_units',v->>'prime_paid','mini_paid_units',v->>'mini_paid')) from jsonb_array_elements(public.lifetime_payroll_report()->'rows') v where lower(v->>'nickname')='yomayow') as verified_player,
 'unchanged' as payouts_sales_stock_attendance_archives;
commit;
"""
rows=query(context+repair)
print('CATEGORY_SALARY_REPAIRED_NO_PAYOUTS_CREATED',json.dumps(rows,ensure_ascii=False),flush=True)
