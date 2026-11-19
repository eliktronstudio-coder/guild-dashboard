begin;
set local statement_timeout='45s';
set local lock_timeout='10s';
create table if not exists private.activity_archive_removal_backups (
 id uuid primary key,guild_id uuid not null references public.guilds(id),created_at timestamptz not null default now(),created_by uuid references public.profiles(id),removed_count integer not null,previous_markers jsonb not null
);
revoke all on private.activity_archive_removal_backups from public,anon,authenticated;
create temporary table archive_clear_guards(name text primary key,digest text) on commit drop;
create temporary table archive_clear_result(removed integer,remaining integer) on commit drop;
-- Transactional table lock prevents any other session seeing the temporary guard suspension.
lock table public.events in access exclusive mode;
do $clear$
declare g uuid;rid uuid:='a44c8c0a-f3cb-4e74-a581-55a8f249e81f'::uuid;ids uuid[];markers jsonb;n integer;affected integer;t text;h text;summary jsonb;prior boolean;
begin
 select id into g from public.guilds where slug='xd' for update;
 if not public.has_permission(g,'events.manage') or not public.has_permission(g,'periods.close') then raise exception 'FORBIDDEN';end if;
 prior:=exists(select 1 from private.activity_archive_removal_backups where id=rid and guild_id=g);
 if prior then
  select previous_markers,removed_count into markers,n from private.activity_archive_removal_backups where id=rid and guild_id=g;
 else
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'deleted_at',e.deleted_at,'version',e.version,'archive_id',e.activity_archive_id) order by e.id),'[]'),count(*)::integer into markers,n
  from public.events e where e.guild_id=g and e.activity_archive_id is not null and e.deleted_at is null and not e.inventory_receipt;
  insert into private.activity_archive_removal_backups(id,guild_id,created_by,removed_count,previous_markers) values(rid,g,private.viewer_id(),n,markers);
 end if;
 select coalesce(array_agg((v->>'id')::uuid),'{}') into ids from jsonb_array_elements(markers) v;
 if exists(select 1 from public.events e join public.period_archives a on a.guild_id=e.guild_id and a.period_from=private.period_start((e.starts_at at time zone 'UTC')::date) where e.id=any(ids)) then raise exception 'CLOSED_FINANCIAL_SOURCE';end if;
 foreach t in array array['treasury_loot','treasury_sales','treasury_awards','treasury_allocations','treasury_payouts','treasury_expenses','inventory_auctions','inventory_auction_sales','inventory_disposals','payroll_batches','salary_payment_requests','salary_statements','period_archives','activity_archives','attendance','activity_reports','activity_evidence','memberships'] loop
  execute format($q$select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb)::text) from public.%I x where guild_id=$1$q$,t) into h using g;
  insert into archive_clear_guards values(t,h);
 end loop;
 select md5(coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]')::text) into h from public.events e where e.guild_id=g and not(e.id=any(ids));
 insert into archive_clear_guards values('untouched_events',h);
 select md5(coalesce(jsonb_agg(to_jsonb(e)-'deleted_at'-'version' order by e.id),'[]')::text) into h from public.events e where e.guild_id=g and e.id=any(ids);
 insert into archive_clear_guards values('activity_contents',h);
 summary:=public.treasury_lifetime_summary();
 if not prior and n>0 then
  if not exists(select 1 from pg_trigger where tgrelid='public.events'::regclass and tgname='activity_archived_event' and tgenabled='O') then raise exception 'UNEXPECTED_ARCHIVE_GUARD_STATE';end if;
  alter table public.events disable trigger activity_archived_event;
  update public.events set deleted_at=now(),version=version+1 where guild_id=g and id=any(ids) and activity_archive_id is not null and deleted_at is null;
  get diagnostics affected=row_count;
  alter table public.events enable trigger activity_archived_event;
  if affected<>n then raise exception 'ARCHIVE_SCOPE_CHANGED';end if;
 end if;
 foreach t in array array['treasury_loot','treasury_sales','treasury_awards','treasury_allocations','treasury_payouts','treasury_expenses','inventory_auctions','inventory_auction_sales','inventory_disposals','payroll_batches','salary_payment_requests','salary_statements','period_archives','activity_archives','attendance','activity_reports','activity_evidence','memberships'] loop
  execute format($q$select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb)::text) from public.%I x where guild_id=$1$q$,t) into h using g;
  if h is distinct from(select digest from archive_clear_guards where name=t) then raise exception 'PRESERVED_DATA_CHANGED: %',t;end if;
 end loop;
 select md5(coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]')::text) into h from public.events e where e.guild_id=g and not(e.id=any(ids));
 if h is distinct from(select digest from archive_clear_guards where name='untouched_events') then raise exception 'CURRENT_ACTIVITY_CHANGED';end if;
 select md5(coalesce(jsonb_agg(to_jsonb(e)-'deleted_at'-'version' order by e.id),'[]')::text) into h from public.events e where e.guild_id=g and e.id=any(ids);
 if h is distinct from(select digest from archive_clear_guards where name='activity_contents') then raise exception 'ACTIVITY_CONTENT_CHANGED';end if;
 if public.treasury_lifetime_summary() is distinct from summary then raise exception 'BALANCES_CHANGED';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.events'::regclass and tgname='activity_archived_event' and tgenabled='O') then raise exception 'ARCHIVE_GUARD_NOT_RESTORED';end if;
 if exists(select 1 from public.events where id=any(ids) and deleted_at is null) then raise exception 'ARCHIVE_NOT_EMPTY';end if;
 if not prior then insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'activities.archive_cleared',rid,jsonb_build_object('count',n,'reason','Удаление всех архивных активностей по запросу владельца; финансовые связи сохранены'));end if;
 insert into archive_clear_result select n,count(*)::integer from public.events where guild_id=g and activity_archive_id is not null and deleted_at is null and not inventory_receipt;
end $clear$;
select removed as removed_archived_activities,remaining as remaining_in_archive,true as money_inventory_and_payments_unchanged,true as current_activities_unchanged,true as archive_guard_restored from archive_clear_result;
commit;
