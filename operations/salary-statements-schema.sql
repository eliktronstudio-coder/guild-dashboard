-- 202611180052_guild_join_attendance.sql

-- Unknown historical dates stay unknown; registration time is never substituted.
alter table public.memberships add column guild_joined_on date check(guild_joined_on>=date '2020-01-01'),add column guild_join_version integer not null default 1 check(guild_join_version>0);
create function public.set_guild_join_date(p_member uuid,p_version integer,p_date date,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare m public.memberships;
begin
 select * into m from public.memberships where id=p_member;
 perform private.lock_finance(m.guild_id,'members.manage');
 select * into m from public.memberships where id=p_member for update;
 if exists(select 1 from public.membership_roles mr join public.roles r on r.id=mr.role_id and r.code='owner' where mr.membership_id=m.id) and m.user_id<>private.viewer_id() then raise exception 'FORBIDDEN';end if;
 if m.guild_join_version is distinct from p_version then raise exception 'STALE_VERSION';end if;
 if (p_date is not null and (not isfinite(p_date) or p_date<date '2020-01-01' or p_date>(now() at time zone 'UTC')::date)) or char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'INVALID_INPUT';end if;
 update public.memberships set guild_joined_on=p_date,guild_join_version=guild_join_version+1 where id=m.id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(m.guild_id,private.viewer_id(),'member.guild_join_date',m.id,jsonb_build_object('nickname',m.nickname,'before',m.guild_joined_on,'after',p_date,'reason',btrim(p_reason)));
end $$;
revoke all on function public.set_guild_join_date(uuid,integer,date,text) from public,anon;
grant execute on function public.set_guild_join_date(uuid,integer,date,text) to authenticated;

create or replace function private.attendance_event_counts(g uuid,p_from timestamptz,p_until timestamptz)
returns table(membership_id uuid,total_count bigint,present_count bigint,prime_total_count bigint,prime_present_count bigint,mini_total_count bigint,mini_present_count bigint,pvp_total_count bigint,pvp_present_count bigint,excused_count bigint,excluded_count bigint,prime_total_weight numeric,prime_present_weight numeric)
language sql stable security definer set search_path='' as $$
 with events as materialized (
 select e.id,e.starts_at,e.kind,private.attendance_bucket(coalesce(nullif(e.activity_banner_name,''),e.title),e.kind) category,coalesce(e.activity_weight,100)::numeric weight
 from private.current_events e where e.guild_id=g and e.status='completed' and e.deleted_at is null and not e.inventory_receipt and e.counts_for_attendance
 and e.starts_at>=p_from and e.starts_at<p_until and e.starts_at<=now()
 )
 select m.id,count(e.id),count(e.id) filter(where a.mark='present'),
 count(e.id) filter(where e.category='prime'),count(e.id) filter(where e.category='prime' and a.mark='present'),
 count(e.id) filter(where e.category='mini_rb'),count(e.id) filter(where e.category='mini_rb' and a.mark='present'),
 count(e.id) filter(where e.kind='pvp'),count(e.id) filter(where e.kind='pvp' and a.mark='present'),
 count(e.id) filter(where a.mark='excused'),count(e.id) filter(where a.mark='excluded'),
 coalesce(sum(e.weight) filter(where e.category='prime'),0),coalesce(sum(e.weight) filter(where e.category='prime' and a.mark='present'),0)
 from public.memberships m left join events e on (m.guild_joined_on is null or e.starts_at>=m.guild_joined_on::timestamp at time zone 'UTC')
 left join public.attendance a on a.guild_id=g and a.event_id=e.id and a.membership_id=m.id where m.guild_id=g group by m.id;
$$;
create or replace function private.weighted_attendance_event_counts(g uuid,p_from timestamptz,p_until timestamptz)
returns table(membership_id uuid,total_count bigint,present_count bigint,prime_total_count bigint,prime_present_count bigint,mini_total_count bigint,mini_present_count bigint,pvp_total_count bigint,pvp_present_count bigint,excused_count bigint,excluded_count bigint,prime_total_weight numeric,prime_present_weight numeric,mini_total_weight numeric,mini_present_weight numeric)
language sql stable security definer set search_path='' as $$
 with events as materialized (
 select e.id,e.starts_at,coalesce(e.activity_weight,100)::numeric weight from private.current_events e
 where e.guild_id=g and e.status='completed' and e.deleted_at is null and not e.inventory_receipt and e.counts_for_attendance
 and e.starts_at>=p_from and e.starts_at<p_until and e.starts_at<=now()
 and private.attendance_bucket(coalesce(nullif(e.activity_banner_name,''),e.title),e.kind)='mini_rb'
 ), weights as (
 select m.id,coalesce(sum(e.weight),0) total,coalesce(sum(e.weight) filter(where a.mark='present'),0) present
 from public.memberships m left join events e on (m.guild_joined_on is null or e.starts_at>=m.guild_joined_on::timestamp at time zone 'UTC')
 left join public.attendance a on a.guild_id=g and a.event_id=e.id and a.membership_id=m.id where m.guild_id=g group by m.id
 )
 select c.*,w.total,w.present from private.attendance_event_counts(g,p_from,p_until) c join weights w on w.id=c.membership_id;
$$;
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.command_attendance_data(timestamptz,timestamptz)'::regprocedure);
 if position('select m.id,m.nickname,m.character_class from' in definition)=0 then raise exception 'EXPECTED_MEMBER_READER_MISSING';end if;
 execute replace(definition,'select m.id,m.nickname,m.character_class from','select m.id,m.nickname,m.character_class,own.guild_joined_on from');
 definition:=pg_get_functiondef('public.archive_activities(uuid,date,date)'::regprocedure);
 execute replace(definition,$old$jsonb_build_object('nickname',m.nickname)$old$,$new$jsonb_build_object('nickname',m.nickname,'guild_joined_on',m.guild_joined_on)$new$);
end $$;
-- Keep existing view columns/ACL and append the explicit guild date.
do $$declare definition text;begin
 definition:=regexp_replace(pg_get_viewdef('public.member_directory'::regclass,true),';[[:space:]]*$','');
 execute 'create or replace view public.member_directory with (security_invoker=true) as select directory.*,member.guild_joined_on from ('||definition||') directory join public.memberships member on member.id=directory.id and member.guild_id=directory.guild_id';
end $$;
notify pgrst,'reload schema';

-- 202611180053_salary_statements.sql

create table public.salary_statements (
 id uuid primary key,guild_id uuid not null references public.guilds(id),status text not null default 'locked' check(status in ('locked','completed','cancelled')),
 signature text not null,snapshot jsonb not null,created_at timestamptz not null default now(),created_by uuid not null references public.profiles(id),
 closed_at timestamptz,closed_by uuid references public.profiles(id),reason text,
 check((status='locked' and closed_at is null and closed_by is null) or (status<>'locked' and closed_at is not null and closed_by is not null))
);
create unique index salary_one_locked_statement on public.salary_statements(guild_id) where status='locked';
alter table public.salary_statements enable row level security;
revoke all on public.salary_statements from public,anon,authenticated;
create function private.guard_salary_statement() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='DELETE' then raise exception 'IMMUTABLE_STATEMENT';end if;
 if old.status<>'locked' or new.status='locked' or (new.id,new.guild_id,new.signature,new.snapshot,new.created_at,new.created_by) is distinct from (old.id,old.guild_id,old.signature,old.snapshot,old.created_at,old.created_by) then raise exception 'IMMUTABLE_STATEMENT';end if;
 return new;
end $$;
create trigger immutable_salary_statement before update or delete on public.salary_statements for each row execute function private.guard_salary_statement();

alter function private.lifetime_payroll(uuid) rename to live_payroll_before_statements;
create function private.lifetime_payroll(g uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare calc jsonb;statement public.salary_statements;rows jsonb;
begin
 calc:=private.live_payroll_before_statements(g);
 select * into statement from public.salary_statements where guild_id=g and status='locked';
 if statement.id is null then return calc||jsonb_build_object('statement',null);end if;
 with combined as (
 select frozen,current,
 greatest(0,(frozen->>'prime_projection')::numeric+(frozen->>'prime_fixed')::numeric+(frozen->>'prime_paid')::numeric-coalesce((current->>'prime_paid')::numeric,0)) p,
 greatest(0,(frozen->>'mini_projection')::numeric+(frozen->>'mini_fixed')::numeric+(frozen->>'mini_paid')::numeric-coalesce((current->>'mini_paid')::numeric,0)) m
 from jsonb_array_elements(statement.snapshot->'rows') frozen left join jsonb_array_elements(calc->'rows') current on current->>'id'=frozen->>'id'
 )
 select coalesce(jsonb_agg(frozen||jsonb_build_object(
 'prime_projection',(p-least(p,coalesce((current->>'prime_fixed')::numeric,0)))::text,
 'mini_projection',(m-least(m,coalesce((current->>'mini_fixed')::numeric,0)))::text,
 'prime_fixed',least(p,coalesce((current->>'prime_fixed')::numeric,0))::text,
 'mini_fixed',least(m,coalesce((current->>'mini_fixed')::numeric,0))::text,
 'prime_paid',coalesce(current->>'prime_paid','0'),'mini_paid',coalesce(current->>'mini_paid','0')) order by frozen->>'id'),'[]') into rows from combined;
 return calc||jsonb_build_object('rows',rows,'points',statement.snapshot->'points','sales',statement.snapshot->'sales',
 'prime_units',coalesce((select sum((v->>'prime_projection')::numeric)::text from jsonb_array_elements(rows) v),'0'),
 'mini_units',coalesce((select sum((v->>'mini_projection')::numeric)::text from jsonb_array_elements(rows) v),'0'),
 'statement',jsonb_build_object('id',statement.id,'status',statement.status,'created_at',statement.created_at));
end $$;

create function public.lock_salary_statement(p_request uuid,p_signature text) returns uuid language plpgsql security definer set search_path='' as $$
declare g uuid;prior public.salary_statements;calc jsonb;activities jsonb;marks jsonb;sales jsonb;dates jsonb;
begin
 select id into g from public.guilds where slug='xd';
 perform private.lock_finance(g,'treasury.allocate');
 if not public.has_permission(g,'treasury.pay') then raise exception 'FORBIDDEN';end if;
 if p_request is null or p_signature is null or p_signature!~'^[a-f0-9]{32}$' then raise exception 'INVALID_INPUT';end if;
 select * into prior from public.salary_statements where id=p_request;
 if prior.id is not null then
 if prior.guild_id=g and prior.signature=p_signature then return prior.id;end if;
 raise exception 'REQUEST_CONFLICT';end if;
 if exists(select 1 from public.salary_statements where guild_id=g and status='locked') then raise exception 'STATEMENT_ALREADY_LOCKED';end if;
 calc:=private.lifetime_payroll(g);
 if md5(calc::text) is distinct from p_signature then raise exception 'CALCULATION_CHANGED';end if;
 if (select coalesce(sum((r->>'prime_projection')::numeric+(r->>'prime_fixed')::numeric+(r->>'mini_projection')::numeric+(r->>'mini_fixed')::numeric),0) from jsonb_array_elements(calc->'rows') r)<=0 then raise exception 'NOTHING_TO_PAY';end if;
 if exists(select 1 from unnest(array['prime','mini_rb']) src where private.fund_balance(g,src)<(select coalesce(sum((r->>(case when src='prime' then 'prime_projection' else 'mini_projection' end))::numeric+(r->>(case when src='prime' then 'prime_fixed' else 'mini_fixed' end))::numeric),0) from jsonb_array_elements(calc->'rows') r)) then raise exception 'INSUFFICIENT_FUNDS';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'starts_at',e.starts_at,'source',private.attendance_bucket(coalesce(nullif(e.activity_banner_name,''),e.title),e.kind),'weight',coalesce(e.activity_weight,100)) order by e.starts_at,e.id),'[]') into activities from private.current_events e where e.guild_id=g and e.status='completed' and e.deleted_at is null and not e.inventory_receipt and e.counts_for_attendance and e.starts_at<=now();
 select coalesce(jsonb_agg(jsonb_build_object('member',a.membership_id,'event',a.event_id) order by a.membership_id,a.event_id),'[]') into marks from public.attendance a join private.current_events e on e.id=a.event_id and e.guild_id=a.guild_id where a.guild_id=g and a.mark='present' and e.status='completed' and e.deleted_at is null and not e.inventory_receipt and e.counts_for_attendance and e.starts_at<=now();
 select coalesce(jsonb_agg(s.id order by s.id),'[]') into sales from public.treasury_sales s where s.guild_id=g and s.voided_at is null and private.live_salary_sale(s.id);
 select coalesce(jsonb_object_agg(m.id::text,to_jsonb(m.guild_joined_on)),'{}') into dates from public.memberships m where m.guild_id=g;
 calc:=calc||jsonb_build_object('activities',activities,'marks',marks,'funded_sales',sales,'join_dates',dates);
 if jsonb_array_length(activities)>10000 or jsonb_array_length(calc->'rows')>1000 or pg_column_size(calc)>15000000 then raise exception 'REPORT_TOO_LARGE';end if;
 insert into public.salary_statements(id,guild_id,signature,snapshot,created_by) values(p_request,g,p_signature,calc,private.viewer_id());
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'salary.statement_locked',p_request,jsonb_build_object('members',jsonb_array_length(calc->'rows'),'prime_units',calc->>'prime_units','mini_units',calc->>'mini_units'));
 return p_request;
end $$;

create function public.close_salary_statement(p_id uuid,p_action text,p_reason text default '') returns void language plpgsql security definer set search_path='' as $$
declare g uuid;s public.salary_statements;calc jsonb;
begin
 select id into g from public.guilds where slug='xd';
 perform private.lock_finance(g,'treasury.allocate');
 if not public.has_permission(g,'treasury.pay') then raise exception 'FORBIDDEN';end if;
 if p_action is null or p_action not in ('completed','cancelled') then raise exception 'INVALID_INPUT';end if;
 select * into s from public.salary_statements where id=p_id and guild_id=g for update;
 if s.id is null then raise exception 'NOT_FOUND';end if;
 if s.status=p_action then return;end if;
 if s.status<>'locked' then raise exception 'STATEMENT_CLOSED';end if;
 if p_action='cancelled' and char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'REASON_REQUIRED';end if;
 calc:=private.lifetime_payroll(g);
 if p_action='completed' and exists(select 1 from jsonb_array_elements(calc->'rows') r where (r->>'prime_projection')::numeric+(r->>'prime_fixed')::numeric+(r->>'mini_projection')::numeric+(r->>'mini_fixed')::numeric>0) then raise exception 'STATEMENT_UNPAID';end if;
 update public.salary_statements set status=p_action,closed_at=now(),closed_by=private.viewer_id(),reason=left(btrim(coalesce(p_reason,'')),500) where id=p_id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'salary.statement_'||p_action,p_id,jsonb_build_object('reason',left(btrim(coalesce(p_reason,'')),500)));
end $$;

-- Protect committed money while preserving normal salary payments and new sales.
create function private.guard_salary_money() returns trigger language plpgsql security definer set search_path='' as $$
declare g uuid;s public.salary_statements;src text;member uuid;pending numeric;member_due numeric;calc jsonb;
begin
 if TG_TABLE_NAME='treasury_sales' then
  if new.voided_at is not distinct from old.voided_at then return new;end if;
  g:=old.guild_id;
 else g:=new.guild_id;end if;
 perform 1 from public.guilds where id=g for update;
 select * into s from public.salary_statements where guild_id=g and status='locked';
 if s.id is null then return new;end if;
 if TG_TABLE_NAME='treasury_sales' then
  if s.snapshot->'funded_sales' ? old.id::text then raise exception 'SALARY_FUNDS_LOCKED';end if;
 elsif TG_TABLE_NAME='treasury_allocations' then
  if s.snapshot->'funded_sales' ? new.sale_id::text and not exists(select 1 from public.payroll_batches b where b.id=new.payroll_id and b.snapshot->>'scope' in ('lifetime','category_live')) then raise exception 'SALARY_FUNDS_LOCKED';end if;
 else
  select sale.source,w.membership_id into src,member from public.treasury_awards w join public.treasury_allocations a on a.id=w.allocation_id join public.treasury_sales sale on sale.id=a.sale_id where w.id=new.award_id;
  calc:=private.lifetime_payroll(g);
  select coalesce(sum((v->>(case when src='prime' then 'prime_projection' else 'mini_projection' end))::numeric+(v->>(case when src='prime' then 'prime_fixed' else 'mini_fixed' end))::numeric),0),
  coalesce(sum((v->>(case when src='prime' then 'prime_projection' else 'mini_projection' end))::numeric+(v->>(case when src='prime' then 'prime_fixed' else 'mini_fixed' end))::numeric) filter(where (v->>'id')::uuid=member),0)
  into pending,member_due from jsonb_array_elements(calc->'rows') v;
  if private.fund_balance(g,src)-new.amount_units<pending-least(member_due,new.amount_units) then raise exception 'SALARY_FUNDS_LOCKED';end if;
 end if;
 return new;
end $$;
create trigger salary_locked_sale before update on public.treasury_sales for each row execute function private.guard_salary_money();
create trigger salary_locked_allocation before insert on public.treasury_allocations for each row execute function private.guard_salary_money();
create trigger salary_locked_payout before insert on public.treasury_payouts for each row execute function private.guard_salary_money();
-- Limit historical/manual obligations to the amount included in this payment quote.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.pay_lifetime_salary(uuid,uuid,text,text)'::regprocedure);
 if position('if award_row.pending>0 then perform' in definition)=0 then raise exception 'EXPECTED_PAYOUT_READER_MISSING';end if;
 definition:=replace(definition,
 'if award_row.pending>0 then perform public.pay_treasury_award(gen_random_uuid(),award_row.id,award_row.version,award_row.pending::bigint,ref);paid_total:=paid_total+award_row.pending;end if;',
 $new$chunk:=least(award_row.pending,(target->>(case when p_source='prime' then 'prime_fixed' else 'mini_fixed' end))::numeric-paid_total)::bigint;
 if chunk>0 then perform public.pay_treasury_award(gen_random_uuid(),award_row.id,award_row.version,chunk,ref);paid_total:=paid_total+chunk;end if;$new$);
 execute definition;
end $$;
revoke all on function private.guard_salary_statement(),private.live_payroll_before_statements(uuid),private.lifetime_payroll(uuid),private.guard_salary_money() from public,anon,authenticated;
revoke all on function public.lock_salary_statement(uuid,text),public.close_salary_statement(uuid,text,text) from public,anon;
grant execute on function public.lock_salary_statement(uuid,text),public.close_salary_statement(uuid,text,text) to authenticated;
notify pgrst,'reload schema';

-- 202611180054_salary_explanations.sql

create function public.salary_breakdown(p_member uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g uuid;me uuid;calc jsonb;r jsonb;point jsonb;s public.salary_statements;joined date;activities jsonb;denominators jsonb;
begin
 select m.guild_id,m.id into g,me from public.memberships m join public.guilds x on x.id=m.guild_id and x.slug='xd' where m.user_id=private.viewer_id() and m.status='active';
 if g is null or not private.is_member(g) or (p_member is distinct from me and not public.has_permission(g,'members.read') and not private.finance_staff(g)) then raise exception 'FORBIDDEN';end if;
 calc:=private.lifetime_payroll(g);
 select v into r from jsonb_array_elements(calc->'rows') v where (v->>'id')::uuid=p_member;
 if r is null then raise exception 'NOT_FOUND';end if;
 select v into point from jsonb_array_elements(calc->'points') v where (v->>'id')::uuid=p_member;
 select * into s from public.salary_statements where guild_id=g and status='locked';
 if s.id is not null then
  joined:=(s.snapshot->'join_dates'->>p_member::text)::date;
  select coalesce(jsonb_agg(e||jsonb_build_object('present',exists(select 1 from jsonb_array_elements(s.snapshot->'marks') a where (a->>'member')::uuid=p_member and a->>'event'=e->>'id')) order by e->>'starts_at',e->>'id'),'[]') into activities
  from jsonb_array_elements(s.snapshot->'activities') e where joined is null or (e->>'starts_at')::timestamptz>=joined::timestamp at time zone 'UTC';
 else
  select guild_joined_on into joined from public.memberships where id=p_member and guild_id=g;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'starts_at',e.starts_at,'source',private.attendance_bucket(coalesce(nullif(e.activity_banner_name,''),e.title),e.kind),'weight',coalesce(e.activity_weight,100),'present',coalesce(a.mark='present',false)) order by e.starts_at,e.id),'[]') into activities
  from private.current_events e left join public.attendance a on a.event_id=e.id and a.membership_id=p_member and a.guild_id=g
  where e.guild_id=g and e.status='completed' and e.deleted_at is null and not e.inventory_receipt and e.counts_for_attendance and e.starts_at<=now()
  and (joined is null or e.starts_at>=joined::timestamp at time zone 'UTC');
 end if;
 select jsonb_build_object('prime',coalesce(sum((p->>'prime_present')::numeric*(p->>'payout_weight')::numeric/100) filter(where (row->>'prime_eligible')::boolean),0),
 'mini',coalesce(sum((p->>'mini_present')::numeric*(p->>'payout_weight')::numeric/100) filter(where (row->>'mini_eligible')::boolean),0)) into denominators
 from jsonb_array_elements(calc->'points') p join jsonb_array_elements(calc->'rows') row on row->>'id'=p->>'id';
 return jsonb_build_object('row',r,'statement',calc->'statement','guild_joined_on',joined,'activities',activities,'points',jsonb_build_object(
 'prime_present',point->'prime_present','prime_total',point->'prime_available','mini_present',point->'mini_present','mini_total',point->'mini_available'),
 'allocation_weights',denominators,'cash',jsonb_build_object('prime',private.fund_balance(g,'prime')::text,'mini',private.fund_balance(g,'mini_rb')::text));
end $$;

create function public.salary_change_history(p_before bigint default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g uuid;entries jsonb;
begin
 select id into g from public.guilds where slug='xd';
 if not public.has_permission(g,'treasury.allocate') then raise exception 'FORBIDDEN';end if;
 with recent as (
 select a.* from public.audit_log a where a.guild_id=g and (p_before is null or a.id<p_before) and
 (a.action like 'salary.%' or a.action in ('member.guild_join_date','member.coefficient','attendance.changed','activity.report_saved','activity.created','activity.deleted','activities.archived','event.changed','event.edited','event.created','treasury.sold','treasury.sale_voided','treasury.payout','treasury.payout_voided','treasury.service_sold','treasury.xd_service_sold'))
 order by a.id desc limit 50
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id::text,'at',a.created_at,'action',a.action,'target_id',a.target_id,
 'actor',coalesce(actor.nickname,'Система'),'target',coalesce(member.nickname,e.title),
 'reason',left(coalesce(a.detail->>'reason',''),500),
 'source',coalesce(a.detail->>'source',a.detail->'sale'->>'source'),
 'amount_units',coalesce(a.detail->>'amount_units',a.detail->>'gross_units',a.detail->'sale'->>'gross_units'),
 'before',case when a.action in ('member.guild_join_date','member.coefficient') then a.detail->'before' else null end,
 'after',case when a.action in ('member.guild_join_date','member.coefficient') then a.detail->'after' else null end,
 'coefficient',coalesce(a.detail->'coefficient',a.detail->'after'->'activity_weight'),
 'previous_coefficient',coalesce(a.detail->'previous_event'->'weight',a.detail->'before'->'activity_weight')) order by a.id desc),'[]') into entries
 from recent a left join public.memberships actor on actor.user_id=a.actor_id and actor.guild_id=g
 left join public.memberships member on member.id=a.target_id and member.guild_id=g left join public.events e on e.id=a.target_id and e.guild_id=g;
 return jsonb_build_object('entries',entries,'next_before',case when jsonb_array_length(entries)=50 then entries->49->>'id' end);
end $$;
revoke all on function public.salary_breakdown(uuid),public.salary_change_history(bigint) from public,anon;
grant execute on function public.salary_breakdown(uuid),public.salary_change_history(bigint) to authenticated;
notify pgrst,'reload schema';

-- 202611180055_salary_change_impacts.sql

-- Record canonical before/after quotes once around each outer mutation, including bot imports.
create function private.record_salary_impact(g uuid,p_operation text,p_target uuid,p_before jsonb,p_after jsonb) returns void language plpgsql security definer set search_path='' as $$
declare changes jsonb;
begin
 with compared as (
 select b,a from jsonb_array_elements(p_before->'rows') b full join jsonb_array_elements(p_after->'rows') a on a->>'id'=b->>'id'
 )
 select coalesce(jsonb_agg(jsonb_build_object('member_id',coalesce(a->>'id',b->>'id'),'nickname',coalesce(a->>'nickname',b->>'nickname'),
 'prime_before',coalesce(((b->>'prime_projection')::numeric+(b->>'prime_fixed')::numeric)::text,'0'),
 'prime_after',coalesce(((a->>'prime_projection')::numeric+(a->>'prime_fixed')::numeric)::text,'0'),
 'mini_before',coalesce(((b->>'mini_projection')::numeric+(b->>'mini_fixed')::numeric)::text,'0'),
 'mini_after',coalesce(((a->>'mini_projection')::numeric+(a->>'mini_fixed')::numeric)::text,'0'),
 'prime_percent_before',b->'prime_percentage','prime_percent_after',a->'prime_percentage',
 'mini_percent_before',b->'mini_percentage','mini_percent_after',a->'mini_percentage') order by coalesce(a->>'id',b->>'id')),'[]') into changes
 from compared where (b->'prime_projection',b->'prime_fixed',b->'mini_projection',b->'mini_fixed',b->'prime_percentage',b->'mini_percentage',b->'prime_eligible',b->'mini_eligible') is distinct from (a->'prime_projection',a->'prime_fixed',a->'mini_projection',a->'mini_fixed',a->'prime_percentage',a->'mini_percentage',a->'prime_eligible',a->'mini_eligible');
 if jsonb_array_length(changes)>0 then
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'salary.calculation_changed',p_target,jsonb_build_object('operation',p_operation,'changes',changes,'deferred',exists(select 1 from public.salary_statements where guild_id=g and status='locked')));
 end if;
end $$;
revoke all on function private.record_salary_impact(uuid,text,uuid,jsonb,jsonb) from public,anon,authenticated;
do $migration$
declare p record;signature text;prior text;arguments text;params text;permission text;result_decl text;invoke text;finish text;definition text;
begin
 for p in select x.*,n.nspname from pg_proc x join pg_namespace n on n.oid=x.pronamespace where n.nspname='public' and x.proname in (
 'record_activity','save_activity_details','cancel_activity','delete_activity','change_event','edit_event','mark_attendance','review_participation_claim','archive_activities',
 'sell_treasury_loot','void_treasury_sale','sell_inventory_auction_now','sell_pending_auction_now','record_xd_service_sale','set_member_weight','set_guild_join_date') order by x.proname loop
 signature:=p.oid::regprocedure::text;
 prior:=p.proname||'_before_salary_history';
 arguments:=pg_get_function_arguments(p.oid);
 select string_agg('$'||i,',' order by i) into params from generate_series(1,p.pronargs) i;
 permission:=case when p.proname='set_member_weight' then 'members.coefficient' when p.proname='set_guild_join_date' then 'members.manage'
 when p.proname='archive_activities' then 'periods.close' when p.proname in ('mark_attendance','review_participation_claim') then 'attendance.manage'
 when p.proname like 'sell_%' or p.proname in ('void_treasury_sale','record_xd_service_sale') then 'treasury.manage' else 'events.manage' end;
 if p.prorettype='void'::regtype then result_decl:='';invoke:=format('perform public.%I(%s);',prior,params);finish:='return;';
 else result_decl:=format('response %s;',p.prorettype::regtype);invoke:=format('response:=public.%I(%s);',prior,params);finish:='return response;';end if;
 execute format('alter function %s rename to %I',signature,prior);
 execute format('revoke all on function public.%I(%s) from public,anon,authenticated',prior,pg_get_function_identity_arguments(p.oid));
 definition:=format($wrapper$
 create function public.%I(%s) returns %s language plpgsql security definer set search_path='' as $wrapped$
 declare g uuid;before_calc jsonb;depth text;%s
 begin
 depth:=current_setting('xd.salary_audit_depth',true);
 if depth='1' then %s %s end if;
 select id into g from public.guilds where slug='xd';
 perform private.lock_finance(g,%L);
 before_calc:=private.live_payroll_before_statements(g);
 perform set_config('xd.salary_audit_depth','1',true);
 %s
 perform set_config('xd.salary_audit_depth',coalesce(depth,'0'),true);
 perform private.record_salary_impact(g,%L,$1,before_calc,private.live_payroll_before_statements(g));
 %s
 end $wrapped$;
 $wrapper$,p.proname,arguments,p.prorettype::regtype,result_decl,invoke,finish,permission,invoke,p.proname,finish);
 execute definition;
 execute format('revoke all on function public.%I(%s) from public,anon',p.proname,pg_get_function_identity_arguments(p.oid));
 execute format('grant execute on function public.%I(%s) to authenticated',p.proname,pg_get_function_identity_arguments(p.oid));
 end loop;
 definition:=pg_get_functiondef('public.salary_change_history(bigint)'::regprocedure);
 definition:=replace(definition,
 $old$'reason',left(coalesce(a.detail->>'reason',''),500),$old$,
 $new$'reason',left(coalesce(a.detail->>'reason',''),500),'changes',a.detail->'changes','deferred',a.detail->'deferred','operation',a.detail->>'operation',$new$);
 execute definition;
end $migration$;
notify pgrst,'reload schema';

-- 202611180056_salary_statement_archive.sql

create function public.salary_statement_report(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g uuid;s public.salary_statements;
begin
 select id into g from public.guilds where slug='xd';
 if not public.has_permission(g,'treasury.allocate') then raise exception 'FORBIDDEN';end if;
 select * into s from public.salary_statements where id=p_id and guild_id=g;
 if s.id is null then raise exception 'NOT_FOUND';end if;
 return jsonb_build_object('id',s.id,'status',s.status,'created_at',s.created_at,'closed_at',s.closed_at,'reason',s.reason,'rows',s.snapshot->'rows',
 'creator',(select nickname from public.memberships where guild_id=g and user_id=s.created_by),
 'closer',(select nickname from public.memberships where guild_id=g and user_id=s.closed_by));
end $$;
revoke all on function public.salary_statement_report(uuid) from public,anon;
grant execute on function public.salary_statement_report(uuid) to authenticated;
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.salary_change_history(bigint)'::regprocedure);
 execute replace(definition,$old$'actor',coalesce(actor.nickname,'Система'),$old$,$new$'actor',coalesce(actor.nickname,'Система'),'statement_id',case when a.action in ('salary.statement_locked','salary.statement_completed','salary.statement_cancelled') then a.target_id end,$new$);
end $$;
notify pgrst,'reload schema';
