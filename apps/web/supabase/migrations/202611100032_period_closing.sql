begin;
create function private.period_start(p_date date) returns date language sql immutable set search_path='' as $$
 select (date_trunc('month',p_date)::date+14-case when extract(day from p_date)<15 then interval '1 month' else interval '0' end)::date
$$;
revoke all on function private.period_start(date) from public,anon,authenticated;
insert into public.permissions(key) values('periods.close');
insert into public.role_permissions(role_id,permission) select id,'periods.close' from public.roles where code in ('owner','admin');
create table public.period_archives(
 id uuid primary key default gen_random_uuid(),guild_id uuid not null references public.guilds(id),period_from date not null,
 closed_at timestamptz not null default now(),closed_by uuid not null references public.profiles(id),snapshot jsonb not null,
 unique(guild_id,period_from),check(extract(day from period_from)=15)
);
alter table public.period_archives enable row level security;
revoke all on public.period_archives from public,anon,authenticated;
grant select on public.period_archives to authenticated;
create policy period_archives_read on public.period_archives for select to authenticated using(private.finance_staff(guild_id) or public.has_permission(guild_id,'periods.close'));
alter table public.treasury_loot add column archived_period date;
alter table public.treasury_sales add column accounting_period date;
update public.treasury_sales set accounting_period=private.period_start((created_at at time zone 'UTC')::date);
alter table public.treasury_sales alter column accounting_period set not null;
create index sales_accounting_period on public.treasury_sales(guild_id,accounting_period);
create function private.sale_period() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='UPDATE' and new.accounting_period is distinct from old.accounting_period then raise exception 'PERIOD_IMMUTABLE'; end if;
 if TG_OP='INSERT' then
  new.accounting_period:=coalesce((select archived_period from public.treasury_loot where id=new.loot_id),private.period_start((new.created_at at time zone 'UTC')::date));
 end if;
 return new;
end $$;
create trigger sale_period before insert or update on public.treasury_sales for each row execute function private.sale_period();
create or replace function private.period_payroll(g uuid,p_from date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; until_date date;
begin
 if p_from is null or extract(day from p_from)<>15 or p_from<date '2020-01-15' or p_from>current_date then raise exception 'INVALID_PERIOD'; end if;
 until_date:=(p_from+interval '1 month')::date;
 with members as (select id,nickname,joined_at,payout_weight,status from public.memberships where guild_id=g),
 events as (select * from public.events where guild_id=g and status='completed' and deleted_at is null and counts_for_attendance and attendance_finalized_at is not null and starts_at>=p_from::timestamp at time zone 'UTC' and starts_at<until_date::timestamp at time zone 'UTC' and starts_at<=now()),
 live_points as (
 select m.id,m.nickname,m.payout_weight,m.status,
 coalesce(sum(coalesce(e.activity_weight,100)) filter(where e.id is not null and coalesce(a.mark,'absent') not in ('excused','excluded')),0)::numeric available,
 coalesce(sum(coalesce(e.activity_weight,100)) filter(where a.mark='present'),0)::numeric present,
 coalesce(sum(coalesce(e.activity_weight,100)) filter(where e.treasury_source='prime' and coalesce(a.mark,'absent') not in ('excused','excluded')),0)::numeric prime_available,
 coalesce(sum(coalesce(e.activity_weight,100)) filter(where e.treasury_source='prime' and a.mark='present'),0)::numeric prime_present,
 coalesce(sum(coalesce(e.activity_weight,100)) filter(where e.treasury_source='mini_rb' and coalesce(a.mark,'absent') not in ('excused','excluded')),0)::numeric mini_available,
 coalesce(sum(coalesce(e.activity_weight,100)) filter(where e.treasury_source='mini_rb' and a.mark='present'),0)::numeric mini_present,
 count(*) filter(where e.kind='pvp' and coalesce(a.mark,'absent') not in ('excused','excluded'))::numeric pvp_available,
 count(*) filter(where e.kind='pvp' and a.mark='present')::numeric pvp_present
 from members m left join events e on (m.joined_at<=e.starts_at or exists(select 1 from public.attendance x where x.event_id=e.id and x.membership_id=m.id)) left join public.attendance a on a.event_id=e.id and a.membership_id=m.id group by m.id,m.nickname,m.payout_weight,m.status
 ), points as (
 select * from live_points where not exists(select 1 from public.period_archives where guild_id=g and period_from=p_from)
 union all
 select r.id,r.nickname,r.payout_weight,r.status,r.available,r.present,r.prime_available,r.prime_present,r.mini_available,r.mini_present,r.pvp_available,r.pvp_present
 from public.period_archives a cross join lateral jsonb_to_recordset(a.snapshot->'points') r(id uuid,nickname text,payout_weight integer,status text,available numeric,present numeric,prime_available numeric,prime_present numeric,mini_available numeric,mini_present numeric,pvp_available numeric,pvp_present numeric)
 where a.guild_id=g and a.period_from=p_from
), eligible as (select *,present*payout_weight as weight from points where status='active' and available>0 and present>0 and present*5>=available),
 sales as (select s.* from public.treasury_sales s where s.guild_id=g and s.voided_at is null and s.accounting_period=p_from),
 free_sales as (select s.* from sales s where not exists(select 1 from public.treasury_allocations a where a.sale_id=s.id and a.voided_at is null)),
 funds as (select src,coalesce(sum(s.fund_units),0)::numeric amount from unnest(array['prime','mini_rb']) src left join free_sales s on s.source=src group by src),
 base as (select f.src,m.id,m.weight,f.amount, sum(m.weight) over(partition by f.src) denominator from funds f cross join eligible m),
 shares as (select *,floor(amount*weight/denominator) amount_units,mod(amount*weight,denominator) remainder from base),
 ranked as (select *,row_number() over(partition by src order by remainder desc,id) rank,amount-sum(amount_units) over(partition by src) spare from shares),
 rounded as (select src,id,(amount_units+case when rank<=spare then 1 else 0 end) amount_units from ranked),
 fixed as (select w.membership_id,s.source,sum(w.amount_units)::numeric amount,sum(coalesce((select sum(p.amount_units) from public.treasury_payouts p where p.award_id=w.id and p.voided_at is null),0))::numeric paid from sales s join public.treasury_allocations a on a.sale_id=s.id and a.voided_at is null join public.treasury_awards w on w.allocation_id=a.id group by w.membership_id,s.source),
 rows as (select p.id,p.nickname,p.payout_weight,p.status,
 p.available::text available,p.present::text present,
 case when p.available>0 then round(100*p.present/p.available,1) end percentage,
 case when p.prime_available>0 then round(100*p.prime_present/p.prime_available,1) end prime_percentage,
 case when p.mini_available>0 then round(100*p.mini_present/p.mini_available,1) end mini_percentage,
 case when p.pvp_available>0 then round(100*p.pvp_present/p.pvp_available,1) end pvp_percentage,
 (p.status='active' and p.available>0 and p.present>0 and p.present*5>=p.available) eligible,
 coalesce((select amount_units from rounded where id=p.id and src='prime'),0)::text prime_projection,
 coalesce((select amount_units from rounded where id=p.id and src='mini_rb'),0)::text mini_projection,
 coalesce((select amount-paid from fixed where membership_id=p.id and source='prime'),0)::text prime_fixed,
 coalesce((select amount-paid from fixed where membership_id=p.id and source='mini_rb'),0)::text mini_fixed,
 coalesce((select paid from fixed where membership_id=p.id and source='prime'),0)::text prime_paid,
 coalesce((select paid from fixed where membership_id=p.id and source='mini_rb'),0)::text mini_paid
 from points p)
 select jsonb_build_object('from',p_from,'until',until_date,'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from rows r),'[]'),
 'points',coalesce((select jsonb_agg(to_jsonb(p)) from points p),'[]'), 'sales',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'source',s.source,'amount_units',s.fund_units::text) order by s.id) from free_sales s),'[]'),
 'prime_units',(select amount::text from funds where src='prime'),'mini_units',(select amount::text from funds where src='mini_rb')) into result;
 return result;
end $$;
create function private.freeze_period_sales(g uuid,p_from date,calc jsonb) returns void language plpgsql security definer set search_path='' as $$
declare batch uuid; sale jsonb; member jsonb; allocation uuid;lo numeric;hi numeric;ml numeric;mh numeric;amount bigint;ids uuid[];src text; total numeric;
begin
 batch:=gen_random_uuid();
 if exists(select 1 from jsonb_array_elements(calc->'rows') v where (v->>'eligible')::boolean) and jsonb_array_length(calc->'sales')>0 then
  insert into public.payroll_batches(id,guild_id,period_from,snapshot,created_by) values(batch,g,p_from,calc,private.viewer_id());
  foreach src in array array['prime','mini_rb'] loop
   total:=(calc->>(case when src='prime' then 'prime_units' else 'mini_units' end))::numeric;
   if private.fund_balance(g,src)-private.fund_reserved(g,src)<total then raise exception 'INSUFFICIENT_FUNDS'; end if;
   lo:=0;
   for sale in select value from jsonb_array_elements(calc->'sales') where value->>'source'=src loop
    hi:=lo+(sale->>'amount_units')::numeric;ml:=0;ids:='{}';
    for member in select value from jsonb_array_elements(calc->'rows') order by value->>'id' loop
     mh:=ml+(member->>(case when src='prime' then 'prime_projection' else 'mini_projection' end))::numeric;
     if least(hi,mh)>greatest(lo,ml) then ids:=array_append(ids,(member->>'id')::uuid); end if;
     ml:=mh;
    end loop;
    if cardinality(ids)>0 then
     allocation:=gen_random_uuid();
     insert into public.treasury_allocations(id,guild_id,sale_id,recipient_ids,reason,created_by,payroll_id) values(allocation,g,(sale->>'id')::uuid,ids,'Зарплата за период 15 → 15; общий порог 20%',private.viewer_id(),batch);
     ml:=0;
     for member in select value from jsonb_array_elements(calc->'rows') order by value->>'id' loop
      mh:=ml+(member->>(case when src='prime' then 'prime_projection' else 'mini_projection' end))::numeric;
      amount:=greatest(0,least(hi,mh)-greatest(lo,ml))::bigint;
      if amount>0 then insert into public.treasury_awards(guild_id,allocation_id,membership_id,nickname_snapshot,amount_units) values(g,allocation,(member->>'id')::uuid,member->>'nickname',amount); end if;
      ml:=mh;
     end loop;
    end if;
    lo:=hi;
   end loop;
  end loop;
 end if;
end $$;
revoke all on function private.freeze_period_sales(uuid,date,jsonb) from public,anon,authenticated;
create or replace function public.pay_period_member(p_request uuid,p_from date,p_member uuid,p_source text,p_signature text,p_reference text) returns void language plpgsql security definer set search_path='' as $$
declare g uuid; calc jsonb; old public.payroll_requests;batch uuid; sale jsonb; member jsonb; allocation uuid;lo numeric;hi numeric;ml numeric;mh numeric;amount bigint;ids uuid[];src text; total numeric; payout_award record;paid numeric; due numeric;
begin
 select guild_id into g from public.memberships where user_id=private.viewer_id() and status='active' limit 1;
 perform private.lock_finance(g,'treasury.pay');
 if not public.has_permission(g,'treasury.allocate') then raise exception 'FORBIDDEN'; end if;
 if p_request is null or p_member is null or p_source is null or p_source not in ('prime','mini_rb') or char_length(btrim(coalesce(p_reference,''))) not between 3 and 500 then raise exception 'INVALID_INPUT'; end if;
 select * into old from public.payroll_requests where id=p_request;
 if old.id is not null then
  if old.guild_id=g and old.membership_id=p_member and old.period_from=p_from and old.source=p_source and old.signature=p_signature and old.reference=btrim(p_reference) then return; end if;
  raise exception 'REQUEST_CONFLICT';
 end if;
 calc:=private.period_payroll(g,p_from);
 if md5(calc::text) is distinct from p_signature then raise exception 'CALCULATION_CHANGED'; end if;
 select (v->>(case when p_source='prime' then 'prime_projection' else 'mini_projection' end))::numeric+(v->>(case when p_source='prime' then 'prime_fixed' else 'mini_fixed' end))::numeric into due from jsonb_array_elements(calc->'rows') v where (v->>'id')::uuid=p_member;
 if due is null or due<=0 then raise exception 'NOTHING_TO_PAY'; end if;
 if jsonb_array_length(calc->'sales')>500 or jsonb_array_length(calc->'rows')>1000 then raise exception 'REPORT_TOO_LARGE'; end if;
 perform private.freeze_period_sales(g,p_from,calc);
 for payout_award in select w.* from public.treasury_awards w join public.treasury_allocations a on a.id=w.allocation_id and a.voided_at is null join public.treasury_sales s on s.id=a.sale_id and s.voided_at is null where w.guild_id=g and w.membership_id=p_member and s.source=p_source and s.accounting_period=p_from order by w.id loop
  select coalesce(sum(amount_units),0) into paid from public.treasury_payouts where award_id=payout_award.id and voided_at is null;
  amount:=(payout_award.amount_units-paid)::bigint;
  if amount>0 then perform public.pay_treasury_award(gen_random_uuid(),payout_award.id,payout_award.version,amount,p_reference); end if;
 end loop;
 insert into public.payroll_requests(id,guild_id,membership_id,period_from,source,signature,reference) values(p_request,g,p_member,p_from,p_source,p_signature,btrim(p_reference));
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'payroll.member_paid',p_request,jsonb_build_object('member_id',p_member,'source',p_source,'period',p_from,'amount_units',due::text));
end $$;
create or replace function public.activity_journal(p_from timestamptz,p_until timestamptz,p_filters jsonb default '{}',p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare g uuid;staff boolean;finance boolean;result jsonb;
begin
 select id into g from public.guilds where slug='xd';
 if not private.is_member(g) then raise exception 'FORBIDDEN'; end if;
 staff:=public.has_permission(g,'attendance.manage');finance:=private.finance_staff(g);
 if p_from is null or p_until is null or p_from>=p_until or p_until-p_from>interval '366 days' or p_page not between 1 and 10000 then raise exception 'INVALID_PERIOD'; end if;
 if coalesce(p_filters->>'player','')<>'' and not staff then raise exception 'FORBIDDEN'; end if;
 with base as (
  select e.id,e.title,e.kind,e.starts_at,e.status,e.treasury_source,e.attendance_finalized_at,e.version,e.activity_banner_id,
   coalesce(r.difficulty,'normal') as difficulty,coalesce(r.is_night,false) as is_night,
   e.activity_banner_photo is not null and e.activity_banner_photo<>'' as has_banner,
   case when staff then case when e.status='scheduled' then (select count(*) from public.event_signups s where s.event_id=e.id) else (select count(*) from public.attendance a where a.event_id=e.id and a.mark='present') end end as participants,
   case when staff and e.attendance_finalized_at is not null and e.status='completed' then (select round(100.0*count(*) filter(where a.mark='present')/nullif(count(*) filter(where a.mark in ('present','absent')),0),1) from public.attendance a where a.event_id=e.id) end as percentage,
   case when finance then (select coalesce(sum(w.amount_units),0) from public.treasury_awards w join public.treasury_allocations x on x.id=w.allocation_id and x.voided_at is null join public.treasury_sales s on s.id=x.sale_id and s.voided_at is null join public.treasury_loot l on l.id=s.loot_id where l.event_id=e.id) end as awarded,
   case when finance then (select coalesce(sum((select coalesce(sum(p.amount_units),0) from public.treasury_payouts p where p.award_id=w.id and p.voided_at is null)),0) from public.treasury_awards w join public.treasury_allocations x on x.id=w.allocation_id and x.voided_at is null join public.treasury_sales s on s.id=x.sale_id and s.voided_at is null join public.treasury_loot l on l.id=s.loot_id where l.event_id=e.id) end as paid
  from public.events e left join public.activity_reports r on r.event_id=e.id
  where e.guild_id=g and e.deleted_at is null and not e.inventory_receipt and not exists(select 1 from public.period_archives pa where pa.guild_id=e.guild_id and pa.period_from=private.period_start((e.starts_at at time zone 'UTC')::date)) and e.starts_at>=p_from and e.starts_at<p_until
   and (coalesce(p_filters->>'source','')='' or e.treasury_source=p_filters->>'source')
   and (coalesce(p_filters->>'kind','')='' or (case when e.kind='pvp' then 'pvp' else 'pve' end)=p_filters->>'kind')
   and (coalesce(p_filters->>'banner','')='' or e.activity_banner_id=(p_filters->>'banner')::uuid)
   and (coalesce(p_filters->>'player','')='' or exists(select 1 from public.attendance a join public.memberships m on m.id=a.membership_id where a.event_id=e.id and a.mark='present' and strpos(lower(m.nickname),lower(p_filters->>'player'))>0) or exists(select 1 from public.event_signups s join public.memberships m on m.id=s.membership_id where s.event_id=e.id and strpos(lower(m.nickname),lower(p_filters->>'player'))>0))
 ), labelled as (
  select *,case when status='cancelled' then 'cancelled' when status='scheduled' then 'scheduled' when awarded>paid then 'pending_payout' when awarded>0 and paid>=awarded then 'paid' when attendance_finalized_at is null then 'unconfirmed' else 'completed' end as journal_status from base
 ), filtered as (
  select * from labelled where coalesce(p_filters->>'status','')='' or journal_status=p_filters->>'status' or (p_filters->>'status'='all_completed' and status='completed')
 ), paged as (select * from filtered order by starts_at desc,id desc offset (p_page-1)*15 limit 15)
 select jsonb_build_object('total',(select count(*) from filtered),'page',p_page,'can_view_roster',staff,'kpis',jsonb_build_object('total',(select count(*) from filtered),'average',(select round(avg(participants),1) from filtered where status='completed' and attendance_finalized_at is not null),'best',(select max(participants) from filtered where status='completed' and attendance_finalized_at is not null),'cancelled',(select count(*) from filtered where status='cancelled')),'rows',coalesce((select jsonb_agg(to_jsonb(p)-'awarded'-'paid' order by p.starts_at desc,p.id desc) from paged p),'[]')) into result;
 return result;
end $$;


create or replace function public.period_payroll_report(p_from date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g uuid;m uuid;calc jsonb;full_read boolean;
begin
 select guild_id,id into g,m from public.memberships where user_id=private.viewer_id() and status='active' limit 1;
 if g is null or not private.is_member(g) then raise exception 'FORBIDDEN'; end if;
 calc:=private.period_payroll(g,p_from);
 full_read:=public.has_permission(g,'members.read') or private.finance_staff(g);
 if not full_read then calc:=jsonb_set(calc,'{rows}',coalesce((select jsonb_agg(v) from jsonb_array_elements(calc->'rows') v where (v->>'id')::uuid=m),'[]')); end if;
 return (calc-'sales'-'points')||jsonb_build_object('signature',case when private.finance_staff(g) then md5(calc::text) end);
end $$;
create function public.close_payroll_period(p_from date,p_signature text) returns uuid language plpgsql security definer set search_path='' as $$
declare g uuid;calc jsonb;result uuid;cutoff timestamptz;stock jsonb;activity jsonb;balances jsonb;
begin
 select guild_id into g from public.memberships where user_id=private.viewer_id() and status='active' limit 1;
 perform private.lock_finance(g,'periods.close');
 select id into result from public.period_archives where guild_id=g and period_from=p_from;
 if result is not null then return result; end if;
 if p_from is null or extract(day from p_from)<>15 or (now() at time zone 'Asia/Yekaterinburg')::date<(p_from+interval '1 month')::date-1 then raise exception 'PERIOD_NOT_ENDED'; end if;
 cutoff:=(p_from+interval '1 month')::timestamp at time zone 'UTC';
 if exists(select 1 from public.participation_claims c join public.events e on e.id=c.event_id where c.guild_id=g and c.status='pending' and e.starts_at>=p_from::timestamp at time zone 'UTC' and e.starts_at<cutoff) then raise exception 'PENDING_CLAIMS'; end if;
 calc:=private.period_payroll(g,p_from);
 if md5(calc::text) is distinct from p_signature then raise exception 'CALCULATION_CHANGED'; end if;
 if jsonb_array_length(calc->'sales')>0 and not exists(select 1 from jsonb_array_elements(calc->'rows') r where (r->>'eligible')::boolean) then raise exception 'NO_RECIPIENTS'; end if;
 if jsonb_array_length(calc->'sales')>500 or jsonb_array_length(calc->'rows')>1000 then raise exception 'REPORT_TOO_LARGE'; end if;
 perform private.freeze_period_sales(g,p_from,calc);
 -- Capture received stock independently of individual activities. Never delete stock.
 update public.treasury_loot set archived_period=p_from where guild_id=g and archived_period is null and created_at<cutoff and quantity_remaining>0;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'source',source,'quantity',quantity_remaining,'estimated_unit_units',estimated_unit_units::text,'received_at',created_at) order by id),'[]') into stock from public.treasury_loot where guild_id=g and archived_period=p_from;
 select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('roster',coalesce((select jsonb_agg(to_jsonb(a)) from public.attendance a where a.event_id=e.id),'[]')) order by e.starts_at,e.id),'[]') into activity from public.events e where e.guild_id=g and e.starts_at>=p_from::timestamp at time zone 'UTC' and e.starts_at<cutoff and e.deleted_at is null and not e.inventory_receipt;
 balances:=jsonb_build_object('prime',private.fund_balance(g,'prime')::text,'mini',private.fund_balance(g,'mini_rb')::text,'guild',private.fund_balance(g,'guild')::text);
 insert into public.period_archives(guild_id,period_from,closed_by,snapshot) values(g,p_from,private.viewer_id(),jsonb_build_object('payroll',calc-'sales'-'points','points',calc->'points','activities',activity,'inventory',stock,'balances',balances)) returning id into result;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'period.closed',result,jsonb_build_object('from',p_from,'until',cutoff));
 return result;
end $$;
revoke all on function public.close_payroll_period(date,text) from public,anon;
grant execute on function public.close_payroll_period(date,text) to authenticated;
-- Guild locking makes closing and ordinary edits serialize; both old and new dates are guarded.
create function private.guard_closed_event() returns trigger language plpgsql security definer set search_path='' as $$
declare g uuid;old_time timestamptz;new_time timestamptz;
begin
 if TG_TABLE_NAME='events' then
  if TG_OP<>'INSERT' then g:=old.guild_id;old_time:=old.starts_at; end if;
  if TG_OP<>'DELETE' then g:=new.guild_id;new_time:=new.starts_at; end if;
 else
  if TG_OP<>'INSERT' then select guild_id,starts_at into g,old_time from public.events where id=old.event_id; end if;
  if TG_OP<>'DELETE' then select guild_id,starts_at into g,new_time from public.events where id=new.event_id; end if;
 end if;
 perform 1 from public.guilds where id=g for update;
 if exists(select 1 from public.period_archives where guild_id=g and (period_from=private.period_start((old_time at time zone 'UTC')::date) or period_from=private.period_start((new_time at time zone 'UTC')::date))) then raise exception 'PERIOD_CLOSED'; end if;
 if TG_OP='DELETE' then return old; end if;return new;
end $$;
create trigger closed_event before insert or update or delete on public.events for each row execute function private.guard_closed_event();
create trigger closed_attendance before insert or update or delete on public.attendance for each row execute function private.guard_closed_event();
create trigger closed_claim before insert or update or delete on public.participation_claims for each row execute function private.guard_closed_event();
-- Closed-period allocated sales cannot be undone, preserving the audit snapshot and paid awards.
create function private.guard_archived_finance() returns trigger language plpgsql security definer set search_path='' as $$
declare g uuid;p date;
begin
 if TG_TABLE_NAME='treasury_sales' then g:=old.guild_id;p:=old.accounting_period;
 elsif TG_TABLE_NAME='treasury_allocations' then select guild_id,accounting_period into g,p from public.treasury_sales where id=old.sale_id;
 else select s.guild_id,s.accounting_period into g,p from public.treasury_awards w join public.treasury_allocations a on a.id=w.allocation_id join public.treasury_sales s on s.id=a.sale_id where w.id=old.award_id; end if;
 perform 1 from public.guilds where id=g for update;
 if new.voided_at is distinct from old.voided_at and exists(select 1 from public.period_archives where guild_id=g and period_from=p) then raise exception 'PERIOD_CLOSED'; end if;
 return new;
end $$;
create trigger archived_sale before update on public.treasury_sales for each row execute function private.guard_archived_finance();
create trigger archived_allocation before update on public.treasury_allocations for each row execute function private.guard_archived_finance();
create trigger archived_payout before update on public.treasury_payouts for each row execute function private.guard_archived_finance();
create function private.guard_archived_stock() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.archived_period is not null and (new.archived_period is distinct from old.archived_period or new.quantity_total<>old.quantity_total or new.source<>old.source or new.name<>old.name) then raise exception 'PERIOD_CLOSED'; end if;
 return new;
end $$;
create trigger archived_stock before update on public.treasury_loot for each row execute function private.guard_archived_stock();
revoke all on function private.guard_archived_stock() from public,anon,authenticated;
revoke all on function private.sale_period(),private.guard_closed_event(),private.guard_archived_finance() from public,anon,authenticated;
alter function public.treasury_summary() rename to treasury_summary_before_periods;
revoke all on function public.treasury_summary_before_periods() from public,anon,authenticated;
create function public.treasury_summary() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g uuid;r jsonb;p date;prime numeric;mini numeric;guild_amount numeric;prime_reserved numeric;mini_reserved numeric;expenses numeric;
begin
 select id into g from public.guilds where slug='xd';
 if not public.has_permission(g,'treasury.read') then raise exception 'FORBIDDEN'; end if;
 r:=public.treasury_summary_before_periods();
 p:=private.period_start((now() at time zone 'UTC')::date);
 select coalesce(sum(fund_units) filter(where source='prime'),0),coalesce(sum(fund_units) filter(where source='mini_rb'),0),coalesce(sum(guild_units),0) into prime,mini,guild_amount from public.treasury_sales where guild_id=g and voided_at is null and accounting_period=p;
 select prime-coalesce(sum(x.amount_units) filter(where s.source='prime'),0),mini-coalesce(sum(x.amount_units) filter(where s.source='mini_rb'),0) into prime,mini from public.treasury_payouts x join public.treasury_awards w on w.id=x.award_id join public.treasury_allocations a on a.id=w.allocation_id join public.treasury_sales s on s.id=a.sale_id where x.guild_id=g and x.voided_at is null and s.accounting_period=p;
 select coalesce(sum(w.amount_units-coalesce((select sum(x.amount_units) from public.treasury_payouts x where x.award_id=w.id and x.voided_at is null),0)) filter(where s.source='prime'),0),coalesce(sum(w.amount_units-coalesce((select sum(x.amount_units) from public.treasury_payouts x where x.award_id=w.id and x.voided_at is null),0)) filter(where s.source='mini_rb'),0) into prime_reserved,mini_reserved from public.treasury_awards w join public.treasury_allocations a on a.id=w.allocation_id and a.voided_at is null join public.treasury_sales s on s.id=a.sale_id where w.guild_id=g and s.accounting_period=p;
 select coalesce(sum(amount_units),0) into expenses from public.treasury_expenses where guild_id=g and voided_at is null and created_at>=p::timestamp at time zone 'UTC';
 guild_amount:=greatest(0,guild_amount-expenses);
 if exists(select 1 from public.period_archives where guild_id=g and period_from=p) then prime:=0;mini:=0;prime_reserved:=0;mini_reserved:=0;guild_amount:=0; end if;
 return r||jsonb_build_object('prime_units',prime::text,'mini_units',mini::text,'guild_units',guild_amount::text,'prime_reserved_units',prime_reserved::text,'mini_reserved_units',mini_reserved::text,'prime_free_units',(prime-prime_reserved)::text,'mini_free_units',(mini-mini_reserved)::text,'archive_prime_units',(private.fund_balance(g,'prime')-prime)::text,'archive_mini_units',(private.fund_balance(g,'mini_rb')-mini)::text,'archive_guild_units',(private.fund_balance(g,'guild')-guild_amount)::text);
end $$;
revoke all on function public.treasury_summary() from public,anon;
grant execute on function public.treasury_summary() to authenticated;
create or replace view public.treasury_inventory with(security_invoker=true) as
select l.id,l.guild_id,l.event_id,l.source,l.name,l.category,l.quantity_total,l.quantity_remaining,
 l.estimated_unit_units::text estimated_unit_units,(l.quantity_remaining*l.estimated_unit_units::numeric)::text estimated_total_units,
 l.note,l.version,l.created_at,e.title event_title,e.starts_at event_starts_at,l.archived_period
from public.treasury_loot l join public.events e on e.id=l.event_id and e.guild_id=l.guild_id;
commit;
