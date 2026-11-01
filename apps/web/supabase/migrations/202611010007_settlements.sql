begin;
insert into public.permissions(key) values('treasury.allocate'),('treasury.pay'),('treasury.spend');
insert into public.role_permissions(role_id,permission)
select id,p from public.roles cross join unnest(array['treasury.allocate','treasury.pay','treasury.spend']) p where code in ('owner','admin','treasurer');

alter table public.treasury_sales add constraint treasury_sales_guild_id unique(guild_id,id);
create table public.treasury_allocations (
 id uuid primary key,guild_id uuid not null,sale_id uuid not null,
 recipient_ids uuid[] not null check(cardinality(recipient_ids) between 1 and 500),
 reason text not null check(char_length(btrim(reason)) between 3 and 500),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 voided_at timestamptz,voided_by uuid references public.profiles(id),void_reason text,
 unique(guild_id,id),foreign key(guild_id,sale_id) references public.treasury_sales(guild_id,id),
 check((voided_at is null and voided_by is null and void_reason is null) or
 (voided_at is not null and voided_by is not null and void_reason is not null and char_length(btrim(void_reason)) between 3 and 500))
);
create unique index treasury_one_active_allocation on public.treasury_allocations(sale_id) where voided_at is null;
create table public.treasury_awards (
 id uuid primary key default gen_random_uuid(),guild_id uuid not null,allocation_id uuid not null,membership_id uuid not null,
 nickname_snapshot text not null,amount_units bigint not null check(amount_units between 1 and 100000000000000),
 version integer not null default 1 check(version>0),
 unique(allocation_id,membership_id),unique(guild_id,id),
 foreign key(guild_id,allocation_id) references public.treasury_allocations(guild_id,id),
 foreign key(guild_id,membership_id) references public.memberships(guild_id,id)
);
create table public.treasury_payouts (
 id uuid primary key,guild_id uuid not null,award_id uuid not null,
 amount_units bigint not null check(amount_units between 1 and 100000000000000),
 reference text not null check(char_length(btrim(reference)) between 3 and 500),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 voided_at timestamptz,voided_by uuid references public.profiles(id),void_reason text,
 foreign key(guild_id,award_id) references public.treasury_awards(guild_id,id),
 check((voided_at is null and voided_by is null and void_reason is null) or
 (voided_at is not null and voided_by is not null and void_reason is not null and char_length(btrim(void_reason)) between 3 and 500))
);
create table public.treasury_expenses (
 id uuid primary key,guild_id uuid not null references public.guilds(id),
 amount_units bigint not null check(amount_units between 1 and 100000000000000),
 purpose text not null check(char_length(btrim(purpose)) between 3 and 500),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 voided_at timestamptz,voided_by uuid references public.profiles(id),void_reason text,
 check((voided_at is null and voided_by is null and void_reason is null) or
 (voided_at is not null and voided_by is not null and void_reason is not null and char_length(btrim(void_reason)) between 3 and 500))
);
create index treasury_awards_member on public.treasury_awards(guild_id,membership_id);
create index treasury_payouts_award on public.treasury_payouts(award_id);
create index treasury_payouts_history on public.treasury_payouts(guild_id,created_at desc,id);
create index treasury_expenses_history on public.treasury_expenses(guild_id,created_at desc,id);

create function private.lock_finance(g uuid,p_permission text) returns void language plpgsql security definer set search_path='' as $$
begin
 if g is null or not public.has_permission(g,p_permission) then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.guilds where id=g for update;
 if not public.has_permission(g,p_permission) then raise exception 'FORBIDDEN'; end if;
end $$;
create function private.finance_staff(g uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.has_permission(g,'treasury.allocate') or public.has_permission(g,'treasury.pay')
$$;
create function private.award_reader(g uuid,m uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.finance_staff(g) or (private.is_member(g) and exists(select 1 from public.memberships where id=m and guild_id=g and user_id=private.viewer_id()))
$$;
-- Call only inside a guild-locked mutation or an authorized read. Numeric sums never overflow bigint.
create function private.fund_balance(g uuid,src text) returns numeric language sql stable security definer set search_path='' as $$
 select coalesce((select sum(case when src='guild' then s.guild_units else s.fund_units end) from public.treasury_sales s
 where s.guild_id=g and s.voided_at is null and (src='guild' or s.source=src)),0)
 -case when src='guild' then coalesce((select sum(x.amount_units) from public.treasury_expenses x where x.guild_id=g and x.voided_at is null),0)
 else coalesce((select sum(p.amount_units) from public.treasury_payouts p join public.treasury_awards w on w.id=p.award_id
 join public.treasury_allocations a on a.id=w.allocation_id join public.treasury_sales s on s.id=a.sale_id
 where p.guild_id=g and p.voided_at is null and s.source=src),0) end
$$;
create function private.fund_reserved(g uuid,src text) returns numeric language sql stable security definer set search_path='' as $$
 select coalesce(sum(w.amount_units-coalesce((select sum(p.amount_units) from public.treasury_payouts p where p.award_id=w.id and p.voided_at is null),0)),0)
 from public.treasury_awards w join public.treasury_allocations a on a.id=w.allocation_id join public.treasury_sales s on s.id=a.sale_id
 where w.guild_id=g and a.voided_at is null and s.source=src
$$;
revoke all on function private.lock_finance(uuid,text),private.finance_staff(uuid),private.award_reader(uuid,uuid),private.fund_balance(uuid,text),private.fund_reserved(uuid,text) from public,anon,authenticated;
grant execute on function private.finance_staff(uuid),private.award_reader(uuid,uuid) to authenticated;

create function private.confirmed_sale_recipients(p_sale_id uuid) returns uuid[] language plpgsql stable security definer set search_path='' as $$
declare s public.treasury_sales;e public.events;ids uuid[];
begin
 select * into s from public.treasury_sales where id=p_sale_id;
 if s.id is null or s.voided_at is not null then raise exception 'SALE_VOIDED'; end if;
 if s.source<>'prime' then raise exception 'SOURCE_NOT_DISTRIBUTED'; end if;
 select e1.* into e from public.events e1 join public.treasury_loot l on l.event_id=e1.id where l.id=s.loot_id;
 if e.status<>'completed' or e.attendance_finalized_at is null then raise exception 'ATTENDANCE_REQUIRED'; end if;
 select array_agg(membership_id order by membership_id) into ids from public.attendance where event_id=e.id and mark='present';
 if coalesce(cardinality(ids),0)=0 then raise exception 'NO_PRESENT_MEMBERS'; end if;
 if cardinality(ids)>500 then raise exception 'TOO_MANY_RECIPIENTS'; end if;
 return ids;
end $$;
revoke all on function private.confirmed_sale_recipients(uuid) from public,anon,authenticated;

create function public.treasury_allocation_preview(p_sale_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.treasury_sales;ids uuid[];n integer;recipients jsonb;
begin
 select * into s from public.treasury_sales where id=p_sale_id;
 if s.id is null or not public.has_permission(s.guild_id,'treasury.allocate') then raise exception 'FORBIDDEN'; end if;
 if exists(select 1 from public.treasury_allocations where sale_id=s.id and voided_at is null) then raise exception 'ALREADY_ALLOCATED'; end if;
 ids:=private.confirmed_sale_recipients(s.id);n:=cardinality(ids);
 if s.fund_units<n then raise exception 'AMOUNT_TOO_SMALL'; end if;
 select jsonb_agg(jsonb_build_object('id',q.id,'nickname',q.nickname,'amount_units',q.amount::text) order by q.id) into recipients
 from (select m.id,m.nickname,s.fund_units/n+case when row_number() over(order by m.id)<=s.fund_units%n then 1 else 0 end amount from public.memberships m where m.guild_id=s.guild_id and m.id=any(ids)) q;
 return jsonb_build_object('sale_id',s.id,'source',s.source,'amount_units',s.fund_units::text,'recipients',recipients);
end $$;

create function public.allocate_treasury_sale(p_request_id uuid,p_sale_id uuid,p_expected_members uuid[],p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.treasury_sales;a public.treasury_allocations;g uuid;ids uuid[];expected uuid[];n integer;
begin
 select guild_id into g from public.treasury_sales where id=p_sale_id;
 perform private.lock_finance(g,'treasury.allocate');
 select * into s from public.treasury_sales where id=p_sale_id for update;
 if p_request_id is null or p_expected_members is null or cardinality(p_expected_members) not between 1 and 500 or array_position(p_expected_members,null) is not null then raise exception 'INVALID_RECIPIENTS'; end if;
 select array_agg(x order by x) into expected from (select distinct unnest(p_expected_members) x) q;
 if cardinality(expected)<>cardinality(p_expected_members) then raise exception 'INVALID_RECIPIENTS'; end if;
 select * into a from public.treasury_allocations where id=p_request_id;
 if a.id is not null then
  if a.guild_id=g and a.sale_id=s.id and a.recipient_ids=expected and a.reason=btrim(p_reason) then
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
 insert into public.treasury_allocations(id,guild_id,sale_id,recipient_ids,reason,created_by) values(p_request_id,g,s.id,ids,btrim(p_reason),private.viewer_id());
 -- Equal shares; leftover minimal units follow stable UUID order, never nickname/client order.
 insert into public.treasury_awards(guild_id,allocation_id,membership_id,nickname_snapshot,amount_units)
 select g,p_request_id,m.id,m.nickname,s.fund_units/n+case when row_number() over(order by m.id)<=s.fund_units%n then 1 else 0 end
 from public.memberships m where m.guild_id=g and m.id=any(ids);
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'treasury.allocated',p_request_id,
 jsonb_build_object('sale_id',s.id,'source',s.source,'amount_units',s.fund_units,'recipients',ids,'reason',btrim(p_reason)));
 return p_request_id;
end $$;
create function public.void_treasury_allocation(p_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare a public.treasury_allocations;g uuid;
begin
 select guild_id into g from public.treasury_allocations where id=p_id;
 perform private.lock_finance(g,'treasury.allocate');
 select * into a from public.treasury_allocations where id=p_id for update;
 if a.voided_at is not null then return; end if;
 if exists(select 1 from public.treasury_payouts p join public.treasury_awards w on w.id=p.award_id where w.allocation_id=a.id and p.voided_at is null) then raise exception 'HAS_PAYOUTS'; end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'REASON_REQUIRED'; end if;
 update public.treasury_allocations set voided_at=now(),voided_by=private.viewer_id(),void_reason=btrim(p_reason) where id=a.id;
 update public.treasury_awards set version=version+1 where allocation_id=a.id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'treasury.allocation_voided',a.id,jsonb_build_object('reason',btrim(p_reason)));
end $$;
create function public.pay_treasury_award(p_request_id uuid,p_award_id uuid,p_version integer,p_amount_units bigint,p_reference text) returns uuid
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
 if private.confirmed_sale_recipients(s.id) is distinct from a.recipient_ids then raise exception 'ATTENDANCE_CHANGED'; end if;
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
create function public.void_treasury_payout(p_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare p public.treasury_payouts;g uuid;
begin
 select guild_id into g from public.treasury_payouts where id=p_id;
 perform private.lock_finance(g,'treasury.pay');
 select * into p from public.treasury_payouts where id=p_id for update;
 if p.voided_at is not null then return; end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'REASON_REQUIRED'; end if;
 update public.treasury_payouts set voided_at=now(),voided_by=private.viewer_id(),void_reason=btrim(p_reason) where id=p.id;
 update public.treasury_awards set version=version+1 where id=p.award_id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'treasury.payout_voided',p.id,jsonb_build_object('payout',to_jsonb(p),'reason',btrim(p_reason)));
end $$;
create function public.record_treasury_expense(p_request_id uuid,p_amount_units bigint,p_purpose text) returns uuid language plpgsql security definer set search_path='' as $$
declare g uuid;x public.treasury_expenses;
begin
 select id into g from public.guilds where slug='xd';
 perform private.lock_finance(g,'treasury.spend');
 select * into x from public.treasury_expenses where id=p_request_id;
 if x.id is not null then
  if x.guild_id=g and x.amount_units=p_amount_units and x.purpose=btrim(p_purpose) then
   if x.voided_at is not null then raise exception 'EXPENSE_VOIDED'; end if;
   return x.id;
  end if;
  raise exception 'REQUEST_CONFLICT';
 end if;
 if p_amount_units is null or p_amount_units not between 1 and 100000000000000 then raise exception 'INVALID_AMOUNT'; end if;
 if p_amount_units>private.fund_balance(g,'guild') then raise exception 'INSUFFICIENT_FUNDS'; end if;
 insert into public.treasury_expenses(id,guild_id,amount_units,purpose,created_by) values(p_request_id,g,p_amount_units,btrim(p_purpose),private.viewer_id());
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'treasury.expense_recorded',p_request_id,jsonb_build_object('amount_units',p_amount_units,'purpose',btrim(p_purpose)));
 return p_request_id;
end $$;
create function public.void_treasury_expense(p_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare x public.treasury_expenses;g uuid;
begin
 select guild_id into g from public.treasury_expenses where id=p_id;
 perform private.lock_finance(g,'treasury.spend');
 select * into x from public.treasury_expenses where id=p_id for update;
 if x.voided_at is not null then return; end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'REASON_REQUIRED'; end if;
 update public.treasury_expenses set voided_at=now(),voided_by=private.viewer_id(),void_reason=btrim(p_reason) where id=x.id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'treasury.expense_voided',x.id,jsonb_build_object('expense',to_jsonb(x),'reason',btrim(p_reason)));
end $$;

-- Upgrade the old endpoint as well: callers cannot bypass new dependencies via the old UI/API.
create or replace function public.void_treasury_sale(p_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare s public.treasury_sales;g uuid;
begin
 select guild_id into g from public.treasury_sales where id=p_id;
 perform private.lock_treasury(g);
 select * into s from public.treasury_sales where id=p_id for update;
 if s.voided_at is not null then return; end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'REASON_REQUIRED'; end if;
 if exists(select 1 from public.treasury_allocations where sale_id=s.id and voided_at is null) then raise exception 'ALLOCATION_EXISTS'; end if;
 if private.fund_balance(g,'guild')<s.guild_units or private.fund_balance(g,s.source)-private.fund_reserved(g,s.source)<s.fund_units then raise exception 'FUNDS_SPENT'; end if;
 perform 1 from public.treasury_loot where id=s.loot_id for update;
 update public.treasury_sales set voided_at=now(),voided_by=private.viewer_id(),void_reason=btrim(p_reason) where id=s.id;
 update public.treasury_loot set quantity_remaining=quantity_remaining+s.quantity,version=version+1 where id=s.loot_id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'treasury.sale_voided',s.id,jsonb_build_object('sale',to_jsonb(s),'reason',btrim(p_reason)));
end $$;

alter table public.treasury_allocations enable row level security;
alter table public.treasury_awards enable row level security;
alter table public.treasury_payouts enable row level security;
alter table public.treasury_expenses enable row level security;
create policy awards_read on public.treasury_awards for select to authenticated using(private.award_reader(guild_id,membership_id));
create policy allocations_read on public.treasury_allocations for select to authenticated using(private.finance_staff(guild_id) or exists(select 1 from public.treasury_awards w where w.allocation_id=treasury_allocations.id));
create policy payouts_read on public.treasury_payouts for select to authenticated using(private.finance_staff(guild_id) or exists(select 1 from public.treasury_awards w where w.id=treasury_payouts.award_id));
create policy expenses_read on public.treasury_expenses for select to authenticated using(public.has_permission(guild_id,'treasury.read'));
revoke all on public.treasury_allocations,public.treasury_awards,public.treasury_payouts,public.treasury_expenses from public,anon,authenticated;
grant select on public.treasury_allocations,public.treasury_awards,public.treasury_payouts,public.treasury_expenses to authenticated;

create view public.treasury_award_accounts with(security_invoker=true) as
select w.id,w.guild_id,w.allocation_id,w.membership_id,w.nickname_snapshot,m.nickname,w.amount_units::text amount_units,
 p.paid::text paid_units,(case when a.voided_at is null then w.amount_units-p.paid else 0 end)::text pending_units,
 w.version,a.created_at,a.voided_at allocation_voided_at,a.reason,a.sale_id,s.source,l.event_id,e.title event_title
from public.treasury_awards w join public.treasury_allocations a on a.id=w.allocation_id
join public.treasury_sales s on s.id=a.sale_id join public.treasury_loot l on l.id=s.loot_id
join public.events e on e.id=l.event_id join public.memberships m on m.id=w.membership_id
left join lateral(select coalesce(sum(amount_units),0) paid from public.treasury_payouts where award_id=w.id and voided_at is null) p on true;
create view public.treasury_allocation_log with(security_invoker=true) as
select a.id,a.guild_id,a.sale_id,a.reason,a.created_at,a.created_by,a.voided_at,a.void_reason,
 cardinality(a.recipient_ids) recipient_count,s.source,s.fund_units::text amount_units,l.name item_name,l.event_id,e.title event_title
from public.treasury_allocations a join public.treasury_sales s on s.id=a.sale_id
join public.treasury_loot l on l.id=s.loot_id join public.events e on e.id=l.event_id;
create view public.treasury_payout_log with(security_invoker=true) as
select p.id,p.guild_id,p.award_id,w.membership_id,w.nickname_snapshot,p.amount_units::text amount_units,p.reference,
 p.created_at,p.created_by,p.voided_at,p.void_reason,s.source
from public.treasury_payouts p join public.treasury_awards w on w.id=p.award_id
join public.treasury_allocations a on a.id=w.allocation_id join public.treasury_sales s on s.id=a.sale_id;
create view public.treasury_expense_log with(security_invoker=true) as
select id,guild_id,amount_units::text amount_units,purpose,created_at,created_by,voided_at,void_reason from public.treasury_expenses;
revoke all on public.treasury_award_accounts,public.treasury_allocation_log,public.treasury_payout_log,public.treasury_expense_log from public,anon,authenticated;
grant select on public.treasury_award_accounts,public.treasury_allocation_log,public.treasury_payout_log,public.treasury_expense_log to authenticated;

-- Preserve the stock and gross-income calculation while adding cash balances/obligations.
alter function public.treasury_summary() set schema private;
alter function private.treasury_summary() rename to treasury_income_summary;
revoke all on function private.treasury_income_summary() from public,anon,authenticated;
create function public.treasury_summary() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g uuid;result jsonb;prime numeric;mini numeric;reserve_prime numeric;reserve_mini numeric;
begin
 select id into g from public.guilds where slug='xd';
 if not public.has_permission(g,'treasury.read') then raise exception 'FORBIDDEN'; end if;
 result:=private.treasury_income_summary();
 prime:=private.fund_balance(g,'prime');mini:=private.fund_balance(g,'mini_rb');
 reserve_prime:=private.fund_reserved(g,'prime');reserve_mini:=private.fund_reserved(g,'mini_rb');
 return result||jsonb_build_object('prime_units',prime::text,'mini_units',mini::text,'guild_units',private.fund_balance(g,'guild')::text,
 'prime_reserved_units',reserve_prime::text,'mini_reserved_units',reserve_mini::text,
 'prime_free_units',(prime-reserve_prime)::text,'mini_free_units',(mini-reserve_mini)::text,
 'guild_expense_units',coalesce((select sum(amount_units) from public.treasury_expenses where guild_id=g and voided_at is null),0)::text);
end $$;
create function public.my_treasury_summary() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g uuid;m uuid;
begin
 select id into g from public.guilds where slug='xd';
 if not private.is_member(g) then raise exception 'FORBIDDEN'; end if;
 select id into m from public.memberships where guild_id=g and user_id=private.viewer_id();
 return (select jsonb_build_object('allocated_units',coalesce(sum(w.amount_units),0)::text,'paid_units',coalesce(sum(p.paid),0)::text,
 'pending_units',coalesce(sum(w.amount_units-p.paid),0)::text)
 from public.treasury_awards w join public.treasury_allocations a on a.id=w.allocation_id
 left join lateral(select coalesce(sum(amount_units),0) paid from public.treasury_payouts where award_id=w.id and voided_at is null) p on true
 where w.guild_id=g and w.membership_id=m and a.voided_at is null);
end $$;
revoke all on function public.treasury_allocation_preview(uuid),public.allocate_treasury_sale(uuid,uuid,uuid[],text),public.void_treasury_allocation(uuid,text),
 public.pay_treasury_award(uuid,uuid,integer,bigint,text),public.void_treasury_payout(uuid,text),public.record_treasury_expense(uuid,bigint,text),
 public.void_treasury_expense(uuid,text),public.treasury_summary(),public.my_treasury_summary() from public,anon;
grant execute on function public.treasury_allocation_preview(uuid),public.allocate_treasury_sale(uuid,uuid,uuid[],text),public.void_treasury_allocation(uuid,text),
 public.pay_treasury_award(uuid,uuid,integer,bigint,text),public.void_treasury_payout(uuid,text),public.record_treasury_expense(uuid,bigint,text),
 public.void_treasury_expense(uuid,text),public.treasury_summary(),public.my_treasury_summary() to authenticated;
commit;
