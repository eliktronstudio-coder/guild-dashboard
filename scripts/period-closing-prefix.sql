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
