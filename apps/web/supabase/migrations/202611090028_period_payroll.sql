begin;
create table public.payroll_batches (
 id uuid primary key, guild_id uuid not null references public.guilds(id), period_from date not null,
 snapshot jsonb not null, created_at timestamptz not null default now(), created_by uuid not null references public.profiles(id),
 unique(guild_id,id)
);
alter table public.payroll_batches enable row level security;
create policy payroll_batches_read on public.payroll_batches for select to authenticated using(private.finance_staff(guild_id));
revoke all on public.payroll_batches from public,anon,authenticated;
grant select on public.payroll_batches to authenticated;
alter table public.treasury_allocations add column payroll_id uuid, add foreign key(guild_id,payroll_id) references public.payroll_batches(guild_id,id);
create function private.period_payroll(g uuid,p_from date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; until_date date;
begin
 if p_from is null or extract(day from p_from)<>15 or p_from<date '2020-01-15' or p_from>current_date then raise exception 'INVALID_PERIOD'; end if;
 until_date:=(p_from+interval '1 month')::date;
 with members as (select id,nickname,joined_at,payout_weight,status from public.memberships where guild_id=g),
 events as (select * from public.events where guild_id=g and status='completed' and deleted_at is null and counts_for_attendance and attendance_finalized_at is not null and starts_at>=p_from::timestamp at time zone 'UTC' and starts_at<until_date::timestamp at time zone 'UTC' and starts_at<=now()),
 points as (
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
 ), eligible as (select *,present*payout_weight as weight from points where status='active' and available>0 and present>0 and present*5>=available),
 sales as (select s.* from public.treasury_sales s where s.guild_id=g and s.voided_at is null and s.created_at>=p_from::timestamp at time zone 'UTC' and s.created_at<until_date::timestamp at time zone 'UTC'),
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
 'sales',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'source',s.source,'amount_units',s.fund_units::text) order by s.id) from free_sales s),'[]'),
 'prime_units',(select amount::text from funds where src='prime'),'mini_units',(select amount::text from funds where src='mini_rb')) into result;
 return result;
end $$;
revoke all on function private.period_payroll(uuid,date) from public,anon,authenticated;
create function public.period_payroll_report(p_from date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g uuid;m uuid;calc jsonb; full_read boolean;
begin
 select guild_id,id into g,m from public.memberships where user_id=private.viewer_id() and status='active' limit 1;
 if g is null or not private.is_member(g) then raise exception 'FORBIDDEN'; end if;
 calc:=private.period_payroll(g,p_from);
 full_read:=public.has_permission(g,'members.read') or private.finance_staff(g);
 if not full_read then
  calc:=jsonb_set(calc,'{rows}',coalesce((select jsonb_agg(v) from jsonb_array_elements(calc->'rows') v where (v->>'id')::uuid=m),'[]'));
 end if;
 return (calc-'sales') || jsonb_build_object('signature',case when private.finance_staff(g) then md5(calc::text) end);
end $$;
create table public.payroll_requests (
 id uuid primary key,guild_id uuid not null references public.guilds(id), membership_id uuid not null references public.memberships(id),
 period_from date not null, source text not null, signature text not null, reference text not null, created_at timestamptz not null default now()
);
alter table public.payroll_requests enable row level security;
revoke all on public.payroll_requests from public,anon,authenticated;
-- Existing API continues to pay old awards; new snapshots deliberately preserve their recipients.
alter function public.pay_treasury_award(uuid,uuid,integer,bigint,text) rename to pay_treasury_award_legacy;
revoke all on function public.pay_treasury_award_legacy(uuid,uuid,integer,bigint,text) from public,anon,authenticated;
create function public.pay_treasury_award(p_request_id uuid,p_award_id uuid,p_version integer,p_amount_units bigint,p_reference text) returns uuid language plpgsql security definer set search_path='' as $$
declare w public.treasury_awards;a public.treasury_allocations;s public.treasury_sales;p public.treasury_payouts;paid numeric;
begin
 select * into w from public.treasury_awards where id=p_award_id;
 perform private.lock_finance(w.guild_id,'treasury.pay');
 select * into a from public.treasury_allocations where id=w.allocation_id;
 if a.payroll_id is null then return public.pay_treasury_award_legacy(p_request_id,p_award_id,p_version,p_amount_units,p_reference); end if;
 select * into w from public.treasury_awards where id=p_award_id for update;
 select * into s from public.treasury_sales where id=a.sale_id;
 select * into p from public.treasury_payouts where id=p_request_id;
 if p.id is not null then
  if p.guild_id=w.guild_id and p.award_id=w.id and p.amount_units=p_amount_units and p.reference=btrim(p_reference) and p.voided_at is null then return p.id; end if;
  raise exception 'REQUEST_CONFLICT';
 end if;
 if a.voided_at is not null or s.voided_at is not null then raise exception 'ALLOCATION_VOIDED'; end if;
 if w.version is distinct from p_version then raise exception 'STALE_VERSION'; end if;
 if p_amount_units is null or p_amount_units not between 1 and 100000000000000 or char_length(btrim(coalesce(p_reference,''))) not between 3 and 500 then raise exception 'INVALID_AMOUNT'; end if;
 select coalesce(sum(amount_units),0) into paid from public.treasury_payouts where award_id=w.id and voided_at is null;
 if p_amount_units>w.amount_units-paid then raise exception 'OVERPAYMENT'; end if;
 if p_amount_units>private.fund_balance(w.guild_id,s.source) then raise exception 'INSUFFICIENT_FUNDS'; end if;
 insert into public.treasury_payouts(id,guild_id,award_id,amount_units,reference,created_by) values(p_request_id,w.guild_id,w.id,p_amount_units,btrim(p_reference),private.viewer_id());
 update public.treasury_awards set version=version+1 where id=w.id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(w.guild_id,private.viewer_id(),'treasury.paid',p_request_id,jsonb_build_object('award_id',w.id,'membership_id',w.membership_id,'source',s.source,'amount_units',p_amount_units,'reference',btrim(p_reference)));
 return p_request_id;
end $$;
create function public.pay_period_member(p_request uuid,p_from date,p_member uuid,p_source text,p_signature text,p_reference text) returns void language plpgsql security definer set search_path='' as $$
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
 for payout_award in select w.* from public.treasury_awards w join public.treasury_allocations a on a.id=w.allocation_id and a.voided_at is null join public.treasury_sales s on s.id=a.sale_id and s.voided_at is null where w.guild_id=g and w.membership_id=p_member and s.source=p_source and s.created_at>=p_from::timestamp at time zone 'UTC' and s.created_at<(p_from+interval '1 month')::timestamp at time zone 'UTC' order by w.id loop
  select coalesce(sum(amount_units),0) into paid from public.treasury_payouts where award_id=payout_award.id and voided_at is null;
  amount:=(payout_award.amount_units-paid)::bigint;
  if amount>0 then perform public.pay_treasury_award(gen_random_uuid(),payout_award.id,payout_award.version,amount,p_reference); end if;
 end loop;
 insert into public.payroll_requests(id,guild_id,membership_id,period_from,source,signature,reference) values(p_request,g,p_member,p_from,p_source,p_signature,btrim(p_reference));
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'payroll.member_paid',p_request,jsonb_build_object('member_id',p_member,'source',p_source,'period',p_from,'amount_units',due::text));
end $$;
revoke all on function public.period_payroll_report(date),public.pay_period_member(uuid,date,uuid,text,text,text),public.pay_treasury_award(uuid,uuid,integer,bigint,text) from public,anon;
grant execute on function public.period_payroll_report(date),public.pay_period_member(uuid,date,uuid,text,text,text),public.pay_treasury_award(uuid,uuid,integer,bigint,text) to authenticated;
-- New sales are distributed through the period calculation; historical allocations remain readable/payable.
revoke execute on function public.allocate_treasury_sale(uuid,uuid,uuid[],text) from authenticated;
do $$begin
 if to_regprocedure('public.allocate_weighted_sale(uuid,uuid,uuid[],text,jsonb)') is not null then execute 'revoke execute on function public.allocate_weighted_sale(uuid,uuid,uuid[],text,jsonb) from authenticated'; end if;
 if to_regprocedure('public.allocate_treasury_pool(uuid,uuid[],jsonb,text)') is not null then execute 'revoke execute on function public.allocate_treasury_pool(uuid,uuid[],jsonb,text) from authenticated'; end if;
end $$;
commit;
