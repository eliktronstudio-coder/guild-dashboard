begin;
-- A pool snapshots the exact preview. Existing allocations and payouts are never rewritten.
create table public.treasury_pools (
 id uuid primary key, guild_id uuid not null references public.guilds(id),
 snapshot jsonb not null, reason text not null check(char_length(btrim(reason)) between 3 and 500),
 created_at timestamptz not null default now(), created_by uuid not null references public.profiles(id),
 unique(guild_id,id)
);
alter table public.treasury_pools enable row level security;
create policy pools_read on public.treasury_pools for select to authenticated using(private.finance_staff(guild_id));
revoke all on public.treasury_pools from public,anon,authenticated;
grant select on public.treasury_pools to authenticated;
alter table public.treasury_allocations add column pool_id uuid, add column calculation jsonb,
 add foreign key(guild_id,pool_id) references public.treasury_pools(guild_id,id);

-- Largest remainders, integer numeric arithmetic, deterministic UUID tie break.
create function private.weighted_amounts(p_total numeric,p_weights jsonb) returns jsonb language sql immutable set search_path='' as $$
 with weights as (select (v->>'id')::uuid id,v->>'nickname' nickname,(v->>'weight')::numeric weight from jsonb_array_elements(p_weights) v),
 base as (select *,sum(weight) over() denominator from weights),
 shares as (select *,floor(p_total*weight/denominator) amount,mod(p_total*weight,denominator) remainder from base),
 ranked as (select *,row_number() over(order by remainder desc,id) rank,p_total-sum(amount) over() spare from shares)
 select jsonb_agg(jsonb_build_object('id',id,'nickname',nickname,'weight',weight::text,'amount_units',(amount+case when rank<=spare then 1 else 0 end)::bigint::text) order by id) from ranked
$$;
revoke all on function private.weighted_amounts(numeric,jsonb) from public,anon,authenticated;
create function public.treasury_pool_preview(p_events uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g uuid; ids uuid[]; events_json jsonb; sales_json jsonb; weights jsonb; recipients jsonb; total numeric;
begin
 select guild_id into g from public.memberships where user_id=private.viewer_id() and status='active' limit 1;
 if not public.has_permission(g,'treasury.allocate') then raise exception 'FORBIDDEN'; end if;
 if p_events is null or cardinality(p_events) not between 1 and 100 or array_position(p_events,null) is not null then raise exception 'INVALID_EVENTS'; end if;
 select array_agg(distinct x order by x) into ids from unnest(p_events) x;
 if cardinality(ids)<>cardinality(p_events) then raise exception 'INVALID_EVENTS'; end if;
 if (select count(*) from public.events where guild_id=g and id=any(ids) and status='completed' and attendance_finalized_at is not null and treasury_source='prime' and boss_id is not null)<>cardinality(ids) then raise exception 'ATTENDANCE_REQUIRED'; end if;
 select jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'boss',e.boss_name,'weight',e.boss_weight,'present',coalesce((select jsonb_agg(a.membership_id order by a.membership_id) from public.attendance a where a.event_id=e.id and a.mark='present'),'[]'::jsonb)) order by e.id) into events_json from public.events e where e.id=any(ids);
 select jsonb_agg(jsonb_build_object('id',s.id,'amount_units',s.fund_units::text) order by s.id),sum(s.fund_units) into sales_json,total from public.treasury_sales s join public.treasury_loot l on l.id=s.loot_id where s.guild_id=g and s.source='prime' and s.voided_at is null and l.event_id=any(ids) and not exists(select 1 from public.treasury_allocations a where a.sale_id=s.id and a.voided_at is null);
 if total is null or total<=0 then raise exception 'NO_FREE_SALES'; end if;
 if jsonb_array_length(sales_json)>500 then raise exception 'TOO_MANY_SALES'; end if;
 if total>100000000000000 then raise exception 'INVALID_AMOUNT'; end if;
 select jsonb_agg(jsonb_build_object('id',id,'nickname',nickname,'weight',weight::text) order by id) into weights from (select m.id,m.nickname,sum(e.boss_weight::numeric*m.payout_weight) weight from public.attendance a join public.events e on e.id=a.event_id join public.memberships m on m.id=a.membership_id where e.id=any(ids) and a.mark='present' group by m.id,m.nickname) q;
 if weights is null then raise exception 'NO_PRESENT_MEMBERS'; end if;
 if jsonb_array_length(weights)>500 then raise exception 'TOO_MANY_RECIPIENTS'; end if;
 recipients:=private.weighted_amounts(total,weights);
 if exists(select 1 from jsonb_array_elements(recipients) v where (v->>'amount_units')::bigint<1) then raise exception 'AMOUNT_TOO_SMALL'; end if;
 return jsonb_build_object('events',events_json,'sales',sales_json,'recipients',recipients,'amount_units',total::bigint::text);
end $$;
create function public.allocate_treasury_pool(p_id uuid,p_events uuid[],p_expected jsonb,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare g uuid; calc jsonb; old public.treasury_pools; sale jsonb; member jsonb; allocation uuid; sale_lo numeric:=0; sale_hi numeric; member_lo numeric; member_hi numeric; amount bigint; recipients uuid[];
begin
 select guild_id into g from public.memberships where user_id=private.viewer_id() and status='active' limit 1;
 perform private.lock_finance(g,'treasury.allocate');
 select * into old from public.treasury_pools where id=p_id;
 if old.id is not null then
 if old.guild_id=g and old.snapshot=p_expected and old.reason=btrim(p_reason) and (select array_agg((v->>'id')::uuid order by v->>'id') from jsonb_array_elements(old.snapshot->'events') v)=(select array_agg(x order by x) from unnest(p_events) x) then
 if exists(select 1 from public.treasury_allocations where pool_id=old.id and voided_at is not null) then raise exception 'ALLOCATION_VOIDED'; end if;
 return old.id; end if;
 raise exception 'REQUEST_CONFLICT'; end if;
 calc:=public.treasury_pool_preview(p_events);
 if calc is distinct from p_expected then raise exception 'CALCULATION_CHANGED'; end if;
 if private.fund_balance(g,'prime')-private.fund_reserved(g,'prime')<(calc->>'amount_units')::numeric then raise exception 'INSUFFICIENT_FUNDS'; end if;
 insert into public.treasury_pools(id,guild_id,snapshot,reason,created_by) values(p_id,g,calc,btrim(p_reason),private.viewer_id());
 -- Intersect cumulative sale capacities with the globally rounded recipient totals.
 -- This preserves exact per-player pool shares AND each sale's original fund amount.
 for sale in select value from jsonb_array_elements(calc->'sales') loop
 sale_hi:=sale_lo+(sale->>'amount_units')::numeric; member_lo:=0; recipients:='{}';
 for member in select value from jsonb_array_elements(calc->'recipients') loop
 member_hi:=member_lo+(member->>'amount_units')::numeric;
 if least(sale_hi,member_hi)>greatest(sale_lo,member_lo) then recipients:=array_append(recipients,(member->>'id')::uuid); end if;
 member_lo:=member_hi;
 end loop;
 allocation:=gen_random_uuid();
 insert into public.treasury_allocations(id,guild_id,sale_id,recipient_ids,reason,created_by,pool_id) values(allocation,g,(sale->>'id')::uuid,recipients,btrim(p_reason),private.viewer_id(),p_id);
 member_lo:=0;
 for member in select value from jsonb_array_elements(calc->'recipients') loop
 member_hi:=member_lo+(member->>'amount_units')::numeric;
 amount:=greatest(0,least(sale_hi,member_hi)-greatest(sale_lo,member_lo))::bigint;
 if amount>0 then insert into public.treasury_awards(guild_id,allocation_id,membership_id,nickname_snapshot,amount_units) values(g,allocation,(member->>'id')::uuid,member->>'nickname',amount); end if;
 member_lo:=member_hi;
 end loop;
 sale_lo:=sale_hi;
 end loop;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'treasury.pool_allocated',p_id,jsonb_build_object('amount_units',calc->>'amount_units','events',p_events,'reason',btrim(p_reason)));
 return p_id;
end $$;
create function private.pool_attendance_valid(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.treasury_pools p cross join lateral jsonb_array_elements(p.snapshot->'events') v left join public.events e on e.id=(v->>'id')::uuid where p.id=p_id and (e.id is null or e.status<>'completed' or e.attendance_finalized_at is null or (v->'present') is distinct from coalesce((select jsonb_agg(a.membership_id order by a.membership_id) from public.attendance a where a.event_id=e.id and a.mark='present'),'[]'::jsonb))) and exists(select 1 from public.treasury_pools where id=p_id)
$$;
revoke all on function private.pool_attendance_valid(uuid) from public,anon,authenticated;
revoke all on function public.treasury_pool_preview(uuid[]),public.allocate_treasury_pool(uuid,uuid[],jsonb,text) from public,anon;
grant execute on function public.treasury_pool_preview(uuid[]),public.allocate_treasury_pool(uuid,uuid[],jsonb,text) to authenticated;
create or replace function public.pay_treasury_award(p_request_id uuid,p_award_id uuid,p_version integer,p_amount_units bigint,p_reference text) returns uuid
language plpgsql security definer set search_path='' as $$
declare w public.treasury_awards;a public.treasury_allocations;s public.treasury_sales;p public.treasury_payouts;g uuid;paid numeric;
begin
 select guild_id into g from public.treasury_awards where id=p_award_id;
 perform private.lock_finance(g,'treasury.pay');
 select * into w from public.treasury_awards where id=p_award_id for update;
 select * into p from public.treasury_payouts where id=p_request_id;
 if p.id is not null then
  if p.guild_id=g and p.award_id=w.id and p.amount_units=p_amount_units and p.reference=btrim(p_reference) then
   if p.voided_at is not null then raise exception 'PAYOUT_VOIDED'; end if;
   return p.id;
  end if;
  raise exception 'REQUEST_CONFLICT';
 end if;
 select * into a from public.treasury_allocations where id=w.allocation_id;
 select * into s from public.treasury_sales where id=a.sale_id;
 if a.voided_at is not null or s.voided_at is not null then raise exception 'ALLOCATION_VOIDED'; end if;
 if a.pool_id is not null then
 if not private.pool_attendance_valid(a.pool_id) then raise exception 'ATTENDANCE_CHANGED'; end if;
 elsif private.confirmed_sale_recipients(s.id) is distinct from a.recipient_ids then raise exception 'ATTENDANCE_CHANGED'; end if;
 if w.version is distinct from p_version then raise exception 'STALE_VERSION'; end if;
 if p_amount_units is null or p_amount_units not between 1 and 100000000000000 then raise exception 'INVALID_AMOUNT'; end if;
 select coalesce(sum(amount_units),0) into paid from public.treasury_payouts where award_id=w.id and voided_at is null;
 if p_amount_units>w.amount_units-paid then raise exception 'OVERPAYMENT'; end if;
 if p_amount_units>private.fund_balance(g,s.source) then raise exception 'INSUFFICIENT_FUNDS'; end if;
 insert into public.treasury_payouts(id,guild_id,award_id,amount_units,reference,created_by) values(p_request_id,g,w.id,p_amount_units,btrim(p_reference),private.viewer_id());
 update public.treasury_awards set version=version+1 where id=w.id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'treasury.paid',p_request_id,
 jsonb_build_object('award_id',w.id,'membership_id',w.membership_id,'source',s.source,'amount_units',p_amount_units,'reference',btrim(p_reference)));
 return p_request_id;
end $$;
create or replace function public.treasury_allocation_preview(p_sale_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.treasury_sales;ids uuid[];n integer;recipients jsonb;
begin
 select * into s from public.treasury_sales where id=p_sale_id;
 if s.id is null or not public.has_permission(s.guild_id,'treasury.allocate') then raise exception 'FORBIDDEN'; end if;
 if exists(select 1 from public.treasury_allocations where sale_id=s.id and voided_at is null) then raise exception 'ALREADY_ALLOCATED'; end if;
 ids:=private.confirmed_sale_recipients(s.id);n:=cardinality(ids);
 if s.fund_units<n then raise exception 'AMOUNT_TOO_SMALL'; end if;
 if exists(select 1 from public.treasury_loot l join public.events e on e.id=l.event_id where l.id=s.loot_id and e.boss_id is not null) then raise exception 'USE_POOL'; end if;
 select private.weighted_amounts(s.fund_units,jsonb_agg(jsonb_build_object('id',m.id,'nickname',m.nickname,'weight',m.payout_weight::text) order by m.id)) into recipients from public.memberships m where m.guild_id=s.guild_id and m.id=any(ids);
 if exists(select 1 from jsonb_array_elements(recipients) v where (v->>'amount_units')::bigint<1) then raise exception 'AMOUNT_TOO_SMALL'; end if;
 return jsonb_build_object('sale_id',s.id,'source',s.source,'amount_units',s.fund_units::text,'recipients',recipients);
end $$;

create function public.allocate_weighted_sale(p_request_id uuid,p_sale_id uuid,p_expected_members uuid[],p_reason text,p_expected jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.treasury_sales;a public.treasury_allocations;g uuid;ids uuid[];expected uuid[];n integer;calc jsonb;
begin
 select guild_id into g from public.treasury_sales where id=p_sale_id;
 perform private.lock_finance(g,'treasury.allocate');
 select * into s from public.treasury_sales where id=p_sale_id for update;
 if p_request_id is null or p_expected_members is null or cardinality(p_expected_members) not between 1 and 500 or array_position(p_expected_members,null) is not null then raise exception 'INVALID_RECIPIENTS'; end if;
 select array_agg(x order by x) into expected from (select distinct unnest(p_expected_members) x) q;
 if cardinality(expected)<>cardinality(p_expected_members) then raise exception 'INVALID_RECIPIENTS'; end if;
 select * into a from public.treasury_allocations where id=p_request_id;
 if a.id is not null then
  if a.guild_id=g and a.sale_id=s.id and a.recipient_ids=expected and a.reason=btrim(p_reason) and a.calculation=p_expected then
   if a.voided_at is not null then raise exception 'ALLOCATION_VOIDED'; end if;
   return a.id;
  end if;
  raise exception 'REQUEST_CONFLICT';
 end if;
 if s.voided_at is not null then raise exception 'SALE_VOIDED'; end if;
 if exists(select 1 from public.treasury_allocations where sale_id=s.id and voided_at is null) then raise exception 'ALREADY_ALLOCATED'; end if;
 ids:=private.confirmed_sale_recipients(s.id);n:=cardinality(ids);
 if ids is distinct from expected then raise exception 'ATTENDANCE_CHANGED'; end if;
 if (select count(*) from public.memberships where guild_id=g and id=any(ids))<>n then raise exception 'INVALID_RECIPIENTS'; end if;
 if s.fund_units<n then raise exception 'AMOUNT_TOO_SMALL'; end if;
 if private.fund_balance(g,s.source)-private.fund_reserved(g,s.source)<s.fund_units then raise exception 'INSUFFICIENT_FUNDS'; end if;
 calc:=public.treasury_allocation_preview(s.id);
 if calc is distinct from p_expected then raise exception 'CALCULATION_CHANGED'; end if;
 insert into public.treasury_allocations(id,guild_id,sale_id,recipient_ids,reason,created_by,calculation) values(p_request_id,g,s.id,ids,btrim(p_reason),private.viewer_id(),calc);
 insert into public.treasury_awards(guild_id,allocation_id,membership_id,nickname_snapshot,amount_units)
 select g,p_request_id,(v->>'id')::uuid,v->>'nickname',(v->>'amount_units')::bigint from jsonb_array_elements(calc->'recipients') v;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'treasury.allocated',p_request_id,
 jsonb_build_object('sale_id',s.id,'source',s.source,'amount_units',s.fund_units,'recipients',ids,'reason',btrim(p_reason)));
 return p_request_id;
end $$;

create or replace function public.allocate_treasury_sale(p_request_id uuid,p_sale_id uuid,p_expected_members uuid[],p_reason text) returns uuid language plpgsql security definer set search_path='' as $$begin raise exception 'CALCULATION_CHANGED'; end $$;
revoke all on function public.allocate_weighted_sale(uuid,uuid,uuid[],text,jsonb) from public,anon;
grant execute on function public.allocate_weighted_sale(uuid,uuid,uuid[],text,jsonb) to authenticated;
create or replace function public.void_treasury_allocation(p_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare a public.treasury_allocations;g uuid;
begin
 select guild_id into g from public.treasury_allocations where id=p_id;
 perform private.lock_finance(g,'treasury.allocate');
 select * into a from public.treasury_allocations where id=p_id for update;
 if a.voided_at is not null then return; end if;
 if exists(select 1 from public.treasury_payouts p join public.treasury_awards w on w.id=p.award_id join public.treasury_allocations a2 on a2.id=w.allocation_id where (a2.id=a.id or (a.pool_id is not null and a2.pool_id=a.pool_id)) and p.voided_at is null) then raise exception 'HAS_PAYOUTS'; end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'REASON_REQUIRED'; end if;
 update public.treasury_allocations set voided_at=now(),voided_by=private.viewer_id(),void_reason=btrim(p_reason) where id=a.id or (a.pool_id is not null and pool_id=a.pool_id);
 update public.treasury_awards set version=version+1 where allocation_id in(select id from public.treasury_allocations where id=a.id or (a.pool_id is not null and pool_id=a.pool_id));
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'treasury.allocation_voided',a.id,jsonb_build_object('reason',btrim(p_reason)));
end $$;

commit;
