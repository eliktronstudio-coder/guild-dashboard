begin;
-- Reuse the established weights, exact remainder allocation and existing ledger.
create function private.lifetime_payroll(g uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 with members as (select id,nickname,joined_at,payout_weight,status from public.memberships where guild_id=g),
 events as (select * from public.events where guild_id=g and status='completed' and deleted_at is null and counts_for_attendance and not inventory_receipt and starts_at<=now()),
 live_points as (
 select m.id,m.nickname,m.payout_weight,m.status,
 coalesce(sum(coalesce(e.activity_weight,100)) filter(where e.id is not null and coalesce(a.mark,'absent') not in ('excused','excluded')),0)::numeric available,
 coalesce(sum(coalesce(e.activity_weight,100)) filter(where a.mark='present'),0)::numeric present,
 c.prime_total_weight prime_available,c.prime_present_weight prime_present,
 coalesce(sum(coalesce(e.activity_weight,100)) filter(where e.treasury_source='mini_rb' and coalesce(a.mark,'absent') not in ('excused','excluded')),0)::numeric mini_available,
 coalesce(sum(coalesce(e.activity_weight,100)) filter(where e.treasury_source='mini_rb' and a.mark='present'),0)::numeric mini_present,
 count(*) filter(where e.kind='pvp' and coalesce(a.mark,'absent') not in ('excused','excluded'))::numeric pvp_available,
 count(*) filter(where e.kind='pvp' and a.mark='present')::numeric pvp_present,
 c.total_count available_count,c.present_count,c.prime_total_count prime_available_count,c.prime_present_count,c.mini_total_count mini_available_count,c.mini_present_count,c.pvp_total_count pvp_available_count,c.pvp_present_count
 from members m join private.attendance_event_counts(g,'-infinity'::timestamptz,'infinity'::timestamptz) c on c.membership_id=m.id left join events e on true left join public.attendance a on a.event_id=e.id and a.membership_id=m.id group by m.id,m.nickname,m.payout_weight,m.status,c.total_count,c.present_count,c.prime_total_count,c.prime_present_count,c.mini_total_count,c.mini_present_count,c.pvp_total_count,c.pvp_present_count,c.prime_total_weight,c.prime_present_weight
 ), points as (select * from live_points
), eligible as (select *,present*payout_weight as weight from points where status='active' and coalesce(available_count,available)>0 and coalesce(present_count,present)>0 and coalesce(present_count,present)*5>=coalesce(available_count,available)),
 sales as (select s.* from public.treasury_sales s where s.guild_id=g and s.voided_at is null),
 free_sales as (select s.* from sales s where not exists(select 1 from public.treasury_allocations a where a.sale_id=s.id and a.voided_at is null)),
 funds as (select src,coalesce(sum(s.fund_units),0)::numeric amount from unnest(array['prime','mini_rb']) src left join free_sales s on s.source=src group by src),
 base as (select f.src,m.id,m.weight,f.amount, sum(m.weight) over(partition by f.src) denominator from funds f cross join eligible m),
 shares as (select *,floor(amount*weight/denominator) amount_units,mod(amount*weight,denominator) remainder from base),
 ranked as (select *,row_number() over(partition by src order by remainder desc,id) rank,amount-sum(amount_units) over(partition by src) spare from shares),
 rounded as (select src,id,(amount_units+case when rank<=spare then 1 else 0 end) amount_units from ranked),
 fixed as (select w.membership_id,s.source,sum(w.amount_units)::numeric amount,sum(coalesce((select sum(p.amount_units) from public.treasury_payouts p where p.award_id=w.id and p.voided_at is null),0))::numeric paid from sales s join public.treasury_allocations a on a.sale_id=s.id and a.voided_at is null join public.treasury_awards w on w.allocation_id=a.id group by w.membership_id,s.source),
 rows as (select p.id,p.nickname,p.payout_weight,p.status,
 p.available::text available,p.present::text present,
 p.available_count attendance_total,p.present_count attendance_present,p.prime_available_count prime_total,p.prime_present_count prime_present,p.mini_available_count mini_total,p.mini_present_count mini_present,p.pvp_available_count pvp_total,p.pvp_present_count pvp_present,
 case when coalesce(p.available_count,p.available)>0 then round(100.0*coalesce(p.present_count,p.present)/coalesce(p.available_count,p.available),case when p.available_count is null then 1 else 0 end) when p.available_count is not null then 0 end percentage,
 case when p.prime_available>0 then round(100.0*p.prime_present/p.prime_available,case when p.available_count is null then 1 else 0 end) when p.available_count is not null then 0 end prime_percentage,
 case when coalesce(p.mini_available_count,p.mini_available)>0 then round(100.0*coalesce(p.mini_present_count,p.mini_present)/coalesce(p.mini_available_count,p.mini_available),case when p.available_count is null then 1 else 0 end) when p.available_count is not null then 0 end mini_percentage,
 case when coalesce(p.pvp_available_count,p.pvp_available)>0 then round(100.0*coalesce(p.pvp_present_count,p.pvp_present)/coalesce(p.pvp_available_count,p.pvp_available),case when p.available_count is null then 1 else 0 end) when p.available_count is not null then 0 end pvp_percentage,
 (p.status='active' and coalesce(p.available_count,p.available)>0 and coalesce(p.present_count,p.present)>0 and coalesce(p.present_count,p.present)*5>=coalesce(p.available_count,p.available)) eligible,
 coalesce((select amount_units from rounded where id=p.id and src='prime'),0)::text prime_projection,
 coalesce((select amount_units from rounded where id=p.id and src='mini_rb'),0)::text mini_projection,
 coalesce((select amount-paid from fixed where membership_id=p.id and source='prime'),0)::text prime_fixed,
 coalesce((select amount-paid from fixed where membership_id=p.id and source='mini_rb'),0)::text mini_fixed,
 coalesce((select paid from fixed where membership_id=p.id and source='prime'),0)::text prime_paid,
 coalesce((select paid from fixed where membership_id=p.id and source='mini_rb'),0)::text mini_paid
 from points p)
 select jsonb_build_object('scope','lifetime','rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from rows r),'[]'),
 'points',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from points p),'[]'), 'sales',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'source',s.source,'amount_units',s.fund_units::text) order by s.id) from free_sales s),'[]'),
 'prime_units',(select amount::text from funds where src='prime'),'mini_units',(select amount::text from funds where src='mini_rb')) into result;
 return result;
end $$;

revoke all on function private.lifetime_payroll(uuid) from public,anon,authenticated;
create function private.freeze_lifetime_sales(g uuid,calc jsonb) returns void language plpgsql security definer set search_path='' as $$
declare batch uuid; sale jsonb; member jsonb; allocation uuid;lo numeric;hi numeric;ml numeric;mh numeric;amount bigint;ids uuid[];src text; total numeric;
begin
 batch:=gen_random_uuid();
 if exists(select 1 from jsonb_array_elements(calc->'rows') v where (v->>'eligible')::boolean) and jsonb_array_length(calc->'sales')>0 then
  insert into public.payroll_batches(id,guild_id,period_from,snapshot,created_by) values(batch,g,private.period_start((now() at time zone 'UTC')::date),calc,private.viewer_id());
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
     insert into public.treasury_allocations(id,guild_id,sale_id,recipient_ids,reason,created_by,payroll_id) values(allocation,g,(sale->>'id')::uuid,ids,'ЗП за всю историю; общий порог 20%',private.viewer_id(),batch);
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
revoke all on function private.freeze_lifetime_sales(uuid,jsonb) from public,anon,authenticated;
create table public.salary_payment_requests (
 id uuid primary key,guild_id uuid not null references public.guilds(id),membership_id uuid not null,
 source text not null check(source in ('prime','mini_rb')),signature text not null,amount_units bigint not null check(amount_units>0),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 foreign key(guild_id,membership_id) references public.memberships(guild_id,id)
);
alter table public.salary_payment_requests enable row level security;
revoke all on public.salary_payment_requests from public,anon,authenticated;
create function public.lifetime_payroll_report() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g uuid;me uuid;calc jsonb;full_read boolean;signature text;
begin
 select m.guild_id,m.id into g,me from public.memberships m join public.guilds x on x.id=m.guild_id and x.slug='xd' where m.user_id=private.viewer_id() and m.status='active';
 if g is null or not private.is_member(g) then raise exception 'FORBIDDEN';end if;
 calc:=private.lifetime_payroll(g);
 full_read:=public.has_permission(g,'members.read') or private.finance_staff(g);
 if public.has_permission(g,'treasury.pay') and public.has_permission(g,'treasury.allocate') then signature:=md5(calc::text);end if;
 if not full_read then calc:=jsonb_set(calc,'{rows}',coalesce((select jsonb_agg(v) from jsonb_array_elements(calc->'rows') v where (v->>'id')::uuid=me),'[]'));end if;
 return (calc-'sales'-'points')||jsonb_build_object('signature',signature);
end $$;
create function public.pay_lifetime_salary(p_request uuid,p_member uuid,p_source text,p_signature text) returns void
language plpgsql security definer set search_path='' as $$
declare g uuid;old public.salary_payment_requests;calc jsonb;target jsonb;due numeric;award_row record;paid numeric;amount bigint;reference text;paid_total numeric:=0;
begin
 select x.id into g from public.guilds x where x.slug='xd';
 perform private.lock_finance(g,'treasury.pay');
 if not public.has_permission(g,'treasury.allocate') then raise exception 'FORBIDDEN';end if;
 if p_request is null or p_member is null or p_source is null or p_source not in ('prime','mini_rb') or p_signature is null or p_signature!~'^[a-f0-9]{32}$' then raise exception 'INVALID_INPUT';end if;
 select * into old from public.salary_payment_requests where id=p_request;
 if old.id is not null then
  if old.guild_id=g and old.membership_id=p_member and old.source=p_source and old.signature=p_signature then return;end if;
  raise exception 'REQUEST_CONFLICT';
 end if;
 calc:=private.lifetime_payroll(g);
 if md5(calc::text) is distinct from p_signature then raise exception 'CALCULATION_CHANGED';end if;
 select v into target from jsonb_array_elements(calc->'rows') v where (v->>'id')::uuid=p_member;
 if target is null or not (target->>'eligible')::boolean then raise exception 'NOT_ELIGIBLE';end if;
 due:=(target->>(case when p_source='prime' then 'prime_projection' else 'mini_projection' end))::numeric+(target->>(case when p_source='prime' then 'prime_fixed' else 'mini_fixed' end))::numeric;
 if due<=0 then raise exception 'NOTHING_TO_PAY';end if;
 if jsonb_array_length(calc->'sales')>500 or jsonb_array_length(calc->'rows')>1000 then raise exception 'REPORT_TOO_LARGE';end if;
 reference:='ЗП '||(case when p_source='prime' then 'Прайм' else 'Мини РБ' end)||' · '||(target->>'nickname');
 perform private.freeze_lifetime_sales(g,calc);
 for award_row in select w.* from public.treasury_awards w join public.treasury_allocations a on a.id=w.allocation_id and a.guild_id=w.guild_id and a.voided_at is null join public.treasury_sales s on s.id=a.sale_id and s.guild_id=a.guild_id and s.voided_at is null where w.guild_id=g and w.membership_id=p_member and s.source=p_source order by w.id loop
  select coalesce(sum(p.amount_units),0) into paid from public.treasury_payouts p where p.award_id=award_row.id and p.voided_at is null;
  amount:=(award_row.amount_units-paid)::bigint;
  if amount>0 then perform public.pay_treasury_award(gen_random_uuid(),award_row.id,award_row.version,amount,reference);paid_total:=paid_total+amount;end if;
 end loop;
 if paid_total<>due then raise exception 'PAYMENT_TOTAL_MISMATCH';end if;
 insert into public.salary_payment_requests(id,guild_id,membership_id,source,signature,amount_units,created_by) values(p_request,g,p_member,p_source,p_signature,due::bigint,private.viewer_id());
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'salary.member_paid',p_request,jsonb_build_object('member_id',p_member,'source',p_source,'amount_units',due::text));
end $$;
revoke all on function public.lifetime_payroll_report(),public.pay_lifetime_salary(uuid,uuid,text,text) from public,anon;
grant execute on function public.lifetime_payroll_report(),public.pay_lifetime_salary(uuid,uuid,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
