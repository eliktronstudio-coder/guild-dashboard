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
