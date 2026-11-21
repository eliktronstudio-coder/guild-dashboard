begin;
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
commit;
