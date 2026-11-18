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


request_id='b578206c-e6ce-4c35-a7a7-64d222c0c538'
context="""begin;set local statement_timeout='45s';set local lock_timeout='10s';
select set_config('request.jwt.claims',(select jsonb_build_object('sub',m.user_id,'session_id',s.id)::text from public.memberships m join public.membership_roles mr on mr.membership_id=m.id join public.roles r on r.id=mr.role_id and r.code='owner' join auth.sessions s on s.user_id=m.user_id join public.profiles p on p.id=m.user_id and not p.blocked where m.status='active' and not exists(select 1 from public.revoked_sessions x where x.session_id=s.id) order by s.created_at desc limit 1),true);
"""
sql="""
create temporary table archive_financial_guard(name text primary key,digest text) on commit drop;
create temporary table archive_operation_result(events integer) on commit drop;
do $operation$
declare g uuid;t text;h text;rid uuid:=REQUEST_UUID;expected integer;n integer;
begin
 select id into g from public.guilds where slug='xd' for update;
 foreach t in array array['treasury_payouts','treasury_sales','treasury_awards','treasury_allocations','treasury_loot','treasury_expenses','payroll_batches','salary_payment_requests','salary_statements','period_archives','memberships','attendance'] loop
 execute format($q$select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb)::text) from public.%I x where guild_id=$1$q$,t) into h using g;
 insert into archive_financial_guard values(t,h);
 end loop;
 select md5(coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]')::text) into h from public.activity_archives a where a.guild_id=g and a.id<>rid;
 insert into archive_financial_guard values('previous_activity_archives',h);
 if not exists(select 1 from public.activity_archives where id=rid and guild_id=g) then
 select count(*) into expected from public.events where guild_id=g and activity_archive_id is null and deleted_at is null and not inventory_receipt and starts_at>='2026-10-15T00:00:00Z' and starts_at<'2026-11-01T00:00:00Z' and starts_at<=now();
 if expected<>122 then raise exception 'ARCHIVE_SCOPE_CHANGED: %',expected;end if;
 end if;
 n:=public.archive_activities(rid,date '2026-10-15',date '2026-10-31');
 if n<>122 then raise exception 'ARCHIVE_COUNT_MISMATCH';end if;
 if exists(select 1 from public.events where guild_id=g and activity_archive_id is null and deleted_at is null and not inventory_receipt and starts_at>='2026-10-15T00:00:00Z' and starts_at<'2026-11-01T00:00:00Z' and starts_at<=now()) then raise exception 'OCTOBER_EVENTS_LEFT_UNARCHIVED';end if;
 foreach t in array array['treasury_payouts','treasury_sales','treasury_awards','treasury_allocations','treasury_loot','treasury_expenses','payroll_batches','salary_payment_requests','salary_statements','period_archives','memberships','attendance'] loop
 execute format($q$select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb)::text) from public.%I x where guild_id=$1$q$,t) into h using g;
 if h is distinct from(select digest from archive_financial_guard where name=t) then raise exception 'PRESERVED_SOURCE_CHANGED: %',t;end if;
 end loop;
 select md5(coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]')::text) into h from public.activity_archives a where a.guild_id=g and a.id<>rid;
 if h is distinct from(select digest from archive_financial_guard where name='previous_activity_archives') then raise exception 'PREVIOUS_ARCHIVE_CHANGED';end if;
 insert into archive_operation_result values(n);
end $operation$;
select (select events from archive_operation_result) as newly_archived,
 count(*) filter(where prime_percentage>0 or mini_percentage>0) as members_with_nonzero_current_attendance,
 coalesce(max(prime_total),0) as current_prime_events,coalesce(max(mini_total),0) as current_mini_events,
 true as money_inventory_payments_and_old_archives_preserved from public.all_time_attendance_report();
commit;
"""
# The only substitution is a locally generated, validated UUID literal.
assert re.fullmatch('[a-f0-9-]{36}',request_id)
sql=sql.replace('REQUEST_UUID',"'"+request_id+"'::uuid")
print('OCTOBER_ACTIVITY_ARCHIVE_VERIFIED',json.dumps(query(context+sql)),flush=True)
