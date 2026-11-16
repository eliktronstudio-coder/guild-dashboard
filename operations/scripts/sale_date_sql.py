"""Build a guarded, one-off date correction; never expose a public backdating API."""
import json,uuid

def correction_sql(rows, operation):
 uuid.UUID(operation)
 if not rows:raise ValueError('No sales selected')
 expected=[]
 for r in rows:
  uuid.UUID(r['id'])
  assert r['accounting_period']=='2026-11-15' and not r['voided']
  expected.append({k:r[k] for k in ['id','source','quantity','gross_units','fund_units','guild_units','accounting_period']})
 payload=json.dumps(expected,separators=(',',':'))
 return r"""begin;
set local lock_timeout='15s';
set local statement_timeout='60s';
select 1 from public.guilds where slug='xd' for update;
lock table public.treasury_sales in access exclusive mode;
create temp table sale_date_expected on commit drop as
select * from jsonb_to_recordset('__EXPECTED__'::jsonb) x(id uuid,source text,quantity integer,gross_units text,fund_units text,guild_units text,accounting_period date);
create temp table sale_date_before on commit drop as select s.* from public.treasury_sales s join sale_date_expected x using(id);
do $$begin
 if exists(select 1 from public.audit_log where action='treasury.sales_backdated_batch' and target_id='__OP__'::uuid) then raise exception 'CORRECTION_ALREADY_APPLIED';end if;
 if (select count(*) from sale_date_before)<>(select count(*) from sale_date_expected) then raise exception 'SALE_SET_CHANGED';end if;
 if exists(select 1 from sale_date_before s join sale_date_expected x using(id) where s.guild_id<>(select id from public.guilds where slug='xd') or s.source<>x.source or s.quantity<>x.quantity or s.gross_units::text<>x.gross_units or s.fund_units::text<>x.fund_units or s.guild_units::text<>x.guild_units or s.accounting_period<>x.accounting_period or s.voided_at is not null) then raise exception 'SALE_CHANGED';end if;
 if exists(select 1 from public.period_archives where guild_id=(select id from public.guilds where slug='xd') and period_from in ('2026-10-15','2026-11-15')) then raise exception 'PERIOD_ALREADY_CLOSED';end if;
 if exists(select 1 from public.treasury_allocations a join sale_date_expected x on x.id=a.sale_id) then raise exception 'SALE_HAS_ALLOCATION_HISTORY';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.treasury_sales'::regclass and tgname='sale_period' and tgenabled='O') then raise exception 'UNEXPECTED_PERIOD_GUARD';end if;
end $$;
create temp table sale_date_guard(name text primary key,digest text) on commit drop;
do $$declare t text;h text;begin
 foreach t in array array['period_archives','payroll_batches','payroll_requests','treasury_allocations','treasury_awards','treasury_payouts','treasury_loot','treasury_expenses','treasury_pools','treasury_cashflows','treasury_openings','inventory_auctions','inventory_transfers','inventory_disposals','events','attendance','memberships','membership_roles'] loop
 if to_regclass('public.'||t) is null then continue;end if;
 execute format('select md5(coalesce(string_agg(md5(row_to_json(r)::text), %L order by md5(row_to_json(r)::text)),%L)) from public.%I r','','',t) into h;
 insert into sale_date_guard values(t,h);
 end loop;end $$;
create temp table sale_date_other_sales on commit drop as select to_jsonb(s) v from public.treasury_sales s where not exists(select 1 from sale_date_expected x where x.id=s.id);
-- The exclusive lock prevents any concurrent writer while this transaction
-- temporarily opens the date guard. Rollback restores both data and guard.
alter table public.treasury_sales disable trigger sale_period;
update public.treasury_sales s set created_at='2026-11-11T12:00:00+05'::timestamptz+(b.created_at-(select min(created_at) from sale_date_before)),accounting_period='2026-10-15'
from sale_date_before b where b.id=s.id;
alter table public.treasury_sales enable trigger sale_period;
do $$declare r record;h text;begin
 if exists(select 1 from public.treasury_sales s join sale_date_before b using(id) where (to_jsonb(s)-'created_at'-'accounting_period') is distinct from (to_jsonb(b)-'created_at'-'accounting_period') or s.accounting_period<>'2026-10-15' or (s.created_at at time zone 'Asia/Yekaterinburg')::date<>'2026-11-11' or (s.created_at at time zone 'UTC')::date<>'2026-11-11') then raise exception 'SALE_CORRECTION_MISMATCH';end if;
 if (select jsonb_agg(v order by v::text) from sale_date_other_sales) is distinct from (select jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text) from public.treasury_sales s where not exists(select 1 from sale_date_expected x where x.id=s.id)) then raise exception 'UNRELATED_SALES_CHANGED';end if;
 for r in select * from sale_date_guard loop
 execute format('select md5(coalesce(string_agg(md5(row_to_json(x)::text), %L order by md5(row_to_json(x)::text)),%L)) from public.%I x','','',r.name) into h;
 if h<>r.digest then raise exception 'Protected data changed: %',r.name;end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgrelid='public.treasury_sales'::regclass and tgname='sale_period' and tgenabled='O') then raise exception 'PERIOD_GUARD_NOT_RESTORED';end if;
end $$;
insert into public.audit_log(guild_id,actor_id,action,target_id,detail)
select s.guild_id,null,'treasury.sale_date_corrected',s.id,jsonb_build_object('operation','__OP__','reason','По запросу владельца сайта: продажи от 11.11.2026, предыдущий расчётный период','before',to_jsonb(b),'after',to_jsonb(s))
from public.treasury_sales s join sale_date_before b using(id);
insert into public.audit_log(guild_id,actor_id,action,target_id,detail)
select (select id from public.guilds where slug='xd'),null,'treasury.sales_backdated_batch','__OP__'::uuid,jsonb_build_object('requested_date','2026-11-11','accounting_period','2026-10-15','count',count(*),'gross_units',sum(gross_units)::text,'fund_units',sum(fund_units)::text,'guild_units',sum(guild_units)::text,'origin','user-requested administrative correction; original rows backed up in audit') from sale_date_before;
commit;
""".replace('__EXPECTED__',payload.replace("'","''")).replace('__OP__',operation)
