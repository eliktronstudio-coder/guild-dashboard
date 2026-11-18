begin;
-- Closed periods and explicit/manual distributions remain historical obligations.
create function private.live_salary_sale(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.treasury_sales s where s.id=p_id
 and not exists(select 1 from public.period_archives h where h.guild_id=s.guild_id and h.period_from=s.accounting_period)
 and not exists(select 1 from public.treasury_allocations a left join public.payroll_batches b on b.id=a.payroll_id
 where a.sale_id=s.id and a.voided_at is null and coalesce(b.snapshot->>'scope','') not in ('lifetime','category_live')))
$$;

-- Preserve the existing attendance reader (including archive exclusions).
alter function private.lifetime_payroll(uuid) rename to lifetime_payroll_before_categories;
create function private.lifetime_payroll(g uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare calc jsonb; result_rows jsonb; src text; key text; entries jsonb; active_ids uuid[]; clipped uuid[];
 total numeric; remaining numeric; denominator numeric; result_shares jsonb; shares jsonb:='{}';
begin
 calc:=private.lifetime_payroll_before_categories(g);
 foreach src in array array['prime','mini_rb'] loop
  key:=case when src='prime' then 'prime' else 'mini' end;
  select coalesce(sum(s.fund_units),0) into total from public.treasury_sales s
   where s.guild_id=g and s.source=src and s.voided_at is null and private.live_salary_sale(s.id);
  select coalesce(jsonb_agg(jsonb_build_object('id',p->>'id','weight',
    case when p->>'status'='active' and (case when src='prime' then (p->>'prime_available')::numeric>0 and (p->>'prime_present')::numeric*5>=(p->>'prime_available')::numeric
    else (p->>'mini_available_count')::numeric>0 and (p->>'mini_present_count')::numeric*5>=(p->>'mini_available_count')::numeric end)
    then (case when src='prime' then (p->>'prime_present')::numeric else (p->>'mini_present_count')::numeric end)*(p->>'payout_weight')::numeric else 0 end,
    'paid',coalesce((select sum(x.amount_units) from public.treasury_payouts x join public.treasury_awards w on w.id=x.award_id join public.treasury_allocations a on a.id=w.allocation_id join public.treasury_sales s on s.id=a.sale_id
      where w.membership_id=(p->>'id')::uuid and s.guild_id=g and s.source=src and x.voided_at is null and private.live_salary_sale(s.id)),0)) order by p->>'id'),'[]') into entries from jsonb_array_elements(calc->'points') p;
  -- Water filling: already paid amounts are irrevocable floors, never new debt.
  select coalesce(array_agg((v->>'id')::uuid),'{}') into active_ids from jsonb_array_elements(entries) v where (v->>'weight')::numeric>0;
  loop
   select greatest(0,total-coalesce(sum((v->>'paid')::numeric) filter(where not ((v->>'id')::uuid=any(active_ids))),0)),
    coalesce(sum((v->>'weight')::numeric) filter(where (v->>'id')::uuid=any(active_ids)),0)
    into remaining,denominator from jsonb_array_elements(entries) v;
   exit when denominator=0;
   select coalesce(array_agg((v->>'id')::uuid),'{}') into clipped from jsonb_array_elements(entries) v
    where (v->>'id')::uuid=any(active_ids) and (v->>'paid')::numeric*denominator>=remaining*(v->>'weight')::numeric;
   exit when cardinality(clipped)=0;
   active_ids:=array(select unnest(active_ids) except select unnest(clipped));
  end loop;
  with raw as (select v->>'id' id,(v->>'paid')::numeric paid,
   floor(remaining*(v->>'weight')::numeric/denominator) target,
   mod(remaining*(v->>'weight')::numeric,denominator) remainder
   from jsonb_array_elements(entries) v where (v->>'id')::uuid=any(active_ids) and denominator>0),
  ranked as (select *,row_number() over(order by remainder desc,id) rank,remaining-sum(target) over() spare from raw)
  select coalesce(jsonb_object_agg(id,greatest(0,target+case when rank<=spare then 1 else 0 end-paid)::text),'{}') into result_shares from ranked;
  shares:=shares||jsonb_build_object(key,result_shares);
 end loop;
 with flags as (select r,
   p->>'status'='active' and (p->>'prime_available')::numeric>0 and (p->>'prime_present')::numeric>0 and (p->>'prime_present')::numeric*5>=(p->>'prime_available')::numeric pe,
   p->>'status'='active' and (p->>'mini_available_count')::numeric>0 and (p->>'mini_present_count')::numeric>0 and (p->>'mini_present_count')::numeric*5>=(p->>'mini_available_count')::numeric me
   from jsonb_array_elements(calc->'rows') r join jsonb_array_elements(calc->'points') p on p->>'id'=r->>'id'),
 fixed as (select w.membership_id,s.source,sum(w.amount_units-coalesce((select sum(x.amount_units) from public.treasury_payouts x where x.award_id=w.id and x.voided_at is null),0)) due
   from public.treasury_awards w join public.treasury_allocations a on a.id=w.allocation_id and a.voided_at is null join public.treasury_sales s on s.id=a.sale_id and s.voided_at is null
   where s.guild_id=g and not private.live_salary_sale(s.id) group by w.membership_id,s.source)
 select jsonb_agg(r||jsonb_build_object('prime_eligible',pe,'mini_eligible',me,'eligible',pe or me,
  'prime_projection',coalesce(shares->'prime'->>(r->>'id'),'0'),'mini_projection',coalesce(shares->'mini'->>(r->>'id'),'0'),
  'prime_fixed',coalesce((select due::text from fixed where membership_id=(r->>'id')::uuid and source='prime'),'0'),
  'mini_fixed',coalesce((select due::text from fixed where membership_id=(r->>'id')::uuid and source='mini_rb'),'0')) order by r->>'id') into result_rows from flags;
 return jsonb_set(calc,'{rows}',coalesce(result_rows,'[]'))||jsonb_build_object('calculation','live_categories_v1',
  'prime_units',coalesce((select sum((v->>'prime_projection')::numeric)::text from jsonb_array_elements(result_rows) v),'0'),
  'mini_units',coalesce((select sum((v->>'mini_projection')::numeric)::text from jsonb_array_elements(result_rows) v),'0'));
end $$;

-- Retain award IDs, payout history and a full audit of replaced pending amounts.
alter table public.treasury_awards drop constraint treasury_awards_amount_units_check;
alter table public.treasury_awards add constraint treasury_awards_amount_units_check check(amount_units between 0 and 100000000000000);
create function private.release_live_salary_awards(g uuid) returns integer language plpgsql security definer set search_path='' as $$
declare w record; n integer:=0;
begin
 for w in select x.*,coalesce((select sum(p.amount_units) from public.treasury_payouts p where p.award_id=x.id and p.voided_at is null),0)::bigint paid
  from public.treasury_awards x join public.treasury_allocations a on a.id=x.allocation_id and a.voided_at is null
  join public.treasury_sales s on s.id=a.sale_id and s.voided_at is null
  where x.guild_id=g and private.live_salary_sale(s.id) order by x.id for update of x loop
  if w.amount_units<>w.paid then
   insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'salary.pending_recalculated',w.id,jsonb_build_object('before',to_jsonb(w),'after_units',w.paid::text,'rule','category_live'));
   update public.treasury_awards set amount_units=w.paid,version=version+1 where id=w.id;
   n:=n+1;
  end if;
 end loop;
 return n;
end $$;
create function public.recalculate_category_salary() returns integer language plpgsql security definer set search_path='' as $$
declare g uuid;
begin
 select id into g from public.guilds where slug='xd';
 perform private.lock_finance(g,'treasury.allocate');
 if not public.has_permission(g,'treasury.pay') then raise exception 'FORBIDDEN';end if;
 return private.release_live_salary_awards(g);
end $$;

create or replace function public.pay_lifetime_salary(p_request uuid,p_member uuid,p_source text,p_signature text) returns void
language plpgsql security definer set search_path='' as $$
declare g uuid;old public.salary_payment_requests;calc jsonb;target jsonb;due bigint;left_due bigint;award_row record;sale_row record;a_id uuid;batch uuid;w_id uuid;ver integer;chunk bigint;ref text;paid_total bigint:=0;dynamic_due bigint;
begin
 select id into g from public.guilds where slug='xd';
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
 if target is null then raise exception 'NOT_ELIGIBLE';end if;
 dynamic_due:=(target->>(case when p_source='prime' then 'prime_projection' else 'mini_projection' end))::bigint;
 due:=dynamic_due+(target->>(case when p_source='prime' then 'prime_fixed' else 'mini_fixed' end))::bigint;
 if not (target->>(case when p_source='prime' then 'prime_eligible' else 'mini_eligible' end))::boolean and due<=0 then raise exception 'NOT_ELIGIBLE';end if;
 if due<=0 then raise exception 'NOTHING_TO_PAY';end if;
 perform private.release_live_salary_awards(g);
 ref:='ЗП '||(case when p_source='prime' then 'Прайм' else 'Мини РБ' end)||' · '||(target->>'nickname');
 -- Historical manual/closed awards retain their original obligations.
 for award_row in select x.*,x.amount_units-coalesce((select sum(p.amount_units) from public.treasury_payouts p where p.award_id=x.id and p.voided_at is null),0) pending
  from public.treasury_awards x join public.treasury_allocations a on a.id=x.allocation_id and a.voided_at is null join public.treasury_sales s on s.id=a.sale_id and s.voided_at is null
  where x.guild_id=g and x.membership_id=p_member and s.source=p_source and not private.live_salary_sale(s.id) order by x.id loop
  if award_row.pending>0 then perform public.pay_treasury_award(gen_random_uuid(),award_row.id,award_row.version,award_row.pending::bigint,ref);paid_total:=paid_total+award_row.pending;end if;
 end loop;
 left_due:=dynamic_due;
 for sale_row in select x.*,x.fund_units-coalesce((select sum(p.amount_units) from public.treasury_payouts p join public.treasury_awards w on w.id=p.award_id join public.treasury_allocations a on a.id=w.allocation_id where a.sale_id=x.id and p.voided_at is null),0) capacity
  from public.treasury_sales x where x.guild_id=g and x.source=p_source and x.voided_at is null and private.live_salary_sale(x.id) order by x.created_at,x.id loop
  exit when left_due<=0;
  chunk:=least(left_due,sale_row.capacity)::bigint;
  if chunk<=0 then continue;end if;
  select id into a_id from public.treasury_allocations where sale_id=sale_row.id and voided_at is null;
  if a_id is null then
   if batch is null then
    batch:=gen_random_uuid();
    insert into public.payroll_batches(id,guild_id,period_from,snapshot,created_by) values(batch,g,private.period_start((now() at time zone 'UTC')::date),calc||jsonb_build_object('scope','category_live'),private.viewer_id());
   end if;
   a_id:=gen_random_uuid();
   insert into public.treasury_allocations(id,guild_id,sale_id,recipient_ids,reason,created_by,payroll_id) values(a_id,g,sale_row.id,array[p_member],'ЗП по посещаемости соответствующей категории',private.viewer_id(),batch);
  else
   update public.treasury_allocations set recipient_ids=array_append(recipient_ids,p_member) where id=a_id and not p_member=any(recipient_ids);
  end if;
  select id,version into w_id,ver from public.treasury_awards where allocation_id=a_id and membership_id=p_member;
  if w_id is null then
   insert into public.treasury_awards(guild_id,allocation_id,membership_id,nickname_snapshot,amount_units) values(g,a_id,p_member,target->>'nickname',chunk) returning id,version into w_id,ver;
  else
   update public.treasury_awards set amount_units=amount_units+chunk,version=version+1 where id=w_id returning version into ver;
  end if;
  perform public.pay_treasury_award(gen_random_uuid(),w_id,ver,chunk,ref);
  paid_total:=paid_total+chunk;left_due:=left_due-chunk;
 end loop;
 if paid_total<>due then raise exception 'PAYMENT_TOTAL_MISMATCH';end if;
 insert into public.salary_payment_requests(id,guild_id,membership_id,source,signature,amount_units,created_by) values(p_request,g,p_member,p_source,p_signature,due,private.viewer_id());
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'salary.member_paid',p_request,jsonb_build_object('member_id',p_member,'source',p_source,'amount_units',due::text,'rule','category_live'));
end $$;

-- Cancel an unpaid automatic distribution together with its sale; paid history remains protected.
alter function public.void_treasury_sale(uuid,text) rename to void_treasury_sale_before_categories;
revoke all on function public.void_treasury_sale_before_categories(uuid,text) from public,anon,authenticated;
create function public.void_treasury_sale(p_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare g uuid;
begin
 select guild_id into g from public.treasury_sales where id=p_id;
 perform private.lock_treasury(g);
 if char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'REASON_REQUIRED';end if;
 if private.live_salary_sale(p_id) then
  if exists(select 1 from public.treasury_payouts p join public.treasury_awards w on w.id=p.award_id join public.treasury_allocations a on a.id=w.allocation_id where a.sale_id=p_id and p.voided_at is null) then raise exception 'FUNDS_SPENT';end if;
  perform private.release_live_salary_awards(g);
  update public.treasury_allocations set voided_at=now(),voided_by=private.viewer_id(),void_reason=btrim(p_reason) where sale_id=p_id and voided_at is null;
 end if;
 perform public.void_treasury_sale_before_categories(p_id,p_reason);
end $$;
revoke all on function private.live_salary_sale(uuid),private.lifetime_payroll_before_categories(uuid),private.lifetime_payroll(uuid),private.release_live_salary_awards(uuid) from public,anon,authenticated;
revoke all on function public.recalculate_category_salary(),public.void_treasury_sale(uuid,text) from public,anon;
grant execute on function public.recalculate_category_salary(),public.void_treasury_sale(uuid,text) to authenticated;
-- Display live salary commitments without reserving them as immutable awards.
create or replace function public.treasury_lifetime_summary() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t jsonb;calc jsonb;g uuid;p numeric;m numeric;
begin
 t:=public.treasury_summary_before_periods();
 select id into g from public.guilds where slug='xd';
 calc:=private.lifetime_payroll(g);
 select coalesce(sum((v->>'prime_projection')::numeric+(v->>'prime_fixed')::numeric),0),
  coalesce(sum((v->>'mini_projection')::numeric+(v->>'mini_fixed')::numeric),0)
 into p,m from jsonb_array_elements(calc->'rows') v;
 return t||jsonb_build_object('prime_reserved_units',p::text,'mini_reserved_units',m::text,
 'prime_free_units',greatest(0,(t->>'prime_units')::numeric-p)::text,
 'mini_free_units',greatest(0,(t->>'mini_units')::numeric-m)::text);
end $$;
-- Personal balances and dashboard use the same live quote as salary payments.
create or replace function public.my_treasury_summary() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g uuid;m uuid;r jsonb;pending numeric;paid numeric;
begin
 select id into g from public.guilds where slug='xd';
 if not private.is_member(g) then raise exception 'FORBIDDEN';end if;
 select id into m from public.memberships where guild_id=g and user_id=private.viewer_id();
 select v into r from jsonb_array_elements(private.lifetime_payroll(g)->'rows') v where (v->>'id')::uuid=m;
 pending:=coalesce((r->>'prime_projection')::numeric+(r->>'prime_fixed')::numeric+(r->>'mini_projection')::numeric+(r->>'mini_fixed')::numeric,0);
 paid:=coalesce((r->>'prime_paid')::numeric+(r->>'mini_paid')::numeric,0);
 return jsonb_build_object('allocated_units',(pending+paid)::text,'paid_units',paid::text,'pending_units',pending::text);
end $$;
notify pgrst,'reload schema';
commit;
