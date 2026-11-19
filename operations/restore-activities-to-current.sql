begin;
set local statement_timeout='120s';
set local lock_timeout='10s';
create temporary table archive_clear_guards(name text primary key,digest text) on commit drop;
create temporary table archive_clear_result(removed integer,remaining integer) on commit drop;
-- Transactional table lock prevents any other session seeing the temporary guard suspension.
lock table public.events in access exclusive mode;
do $clear$
declare g uuid;rid uuid:='a44c8c0a-f3cb-4e74-a581-55a8f249e81f'::uuid;ids uuid[];markers jsonb;n integer;affected integer;t text;h text;prior boolean;
begin
 select id into g from public.guilds where slug='xd' for update;
 if not public.has_permission(g,'events.manage') or not public.has_permission(g,'periods.close') then raise exception 'FORBIDDEN';end if;
 select previous_markers,removed_count into markers,n from private.activity_archive_removal_backups where id=rid and guild_id=g;
 if n is distinct from 218 then raise exception 'RESTORE_BACKUP_MISSING_OR_CHANGED';end if;
 select coalesce(array_agg((v->>'id')::uuid),'{}') into ids from jsonb_array_elements(markers) v;
 if exists(select 1 from public.events e join public.period_archives a on a.guild_id=e.guild_id and a.period_from=private.period_start((e.starts_at at time zone 'UTC')::date) where e.id=any(ids)) then raise exception 'CLOSED_FINANCIAL_SOURCE';end if;
 foreach t in array array['treasury_loot','treasury_sales','treasury_awards','treasury_allocations','treasury_payouts','treasury_expenses','inventory_auctions','inventory_auction_sales','inventory_disposals','payroll_batches','salary_payment_requests','salary_statements','period_archives','activity_archives','attendance','activity_reports','activity_evidence','memberships'] loop
  execute format($q$select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb)::text) from public.%I x where guild_id=$1$q$,t) into h using g;
  insert into archive_clear_guards values(t,h);
 end loop;
 select md5(coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]')::text) into h from public.events e where e.guild_id=g and not(e.id=any(ids));
 insert into archive_clear_guards values('untouched_events',h);
 select md5(coalesce(jsonb_agg(to_jsonb(e)-'deleted_at'-'version'-'activity_archive_id' order by e.id),'[]')::text) into h from public.events e where e.guild_id=g and e.id=any(ids);
 insert into archive_clear_guards values('activity_contents',h);

 if (select count(*) from public.events where guild_id=g and id=any(ids))<>n then raise exception 'RESTORE_EVENTS_MISSING';end if;
 if exists(select 1 from public.events e join jsonb_array_elements(markers) v on e.id=(v->>'id')::uuid where e.activity_archive_id is not null and (e.activity_archive_id is distinct from (v->>'archive_id')::uuid or e.deleted_at is null)) then raise exception 'RESTORE_SCOPE_CHANGED';end if;
 prior:=not exists(select 1 from public.events where guild_id=g and id=any(ids) and activity_archive_id is not null);
 if prior and exists(select 1 from public.events where guild_id=g and id=any(ids) and deleted_at is not null) then raise exception 'RESTORE_ALREADY_MODIFIED';end if;
 if not prior then
  if not exists(select 1 from pg_trigger where tgrelid='public.events'::regclass and tgname='activity_archived_event' and tgenabled='O') then raise exception 'UNEXPECTED_ARCHIVE_GUARD_STATE';end if;
  alter table public.events disable trigger activity_archived_event;
  update public.events set deleted_at=null,activity_archive_id=null,version=version+1 where guild_id=g and id=any(ids) and activity_archive_id is not null and deleted_at is not null;
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
 select md5(coalesce(jsonb_agg(to_jsonb(e)-'deleted_at'-'version'-'activity_archive_id' order by e.id),'[]')::text) into h from public.events e where e.guild_id=g and e.id=any(ids);
 if h is distinct from(select digest from archive_clear_guards where name='activity_contents') then raise exception 'ACTIVITY_CONTENT_CHANGED';end if;

 if not exists(select 1 from pg_trigger where tgrelid='public.events'::regclass and tgname='activity_archived_event' and tgenabled='O') then raise exception 'ARCHIVE_GUARD_NOT_RESTORED';end if;
 if exists(select 1 from public.events where id=any(ids) and (deleted_at is not null or activity_archive_id is not null)) then raise exception 'RESTORE_INCOMPLETE';end if;
 if not prior then insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'activities.archive_restored',rid,jsonb_build_object('count',n,'reason','Восстановление ранее удаленных 218 активностей в текущий журнал по запросу владельца; посещаемость возобновлена'));end if;
 insert into archive_clear_result select n,count(*)::integer from public.events where guild_id=g and activity_archive_id is not null and deleted_at is null and not inventory_receipt;
end $clear$;
select removed as restored_current_activities,remaining as remaining_in_archive,true as money_inventory_and_payments_unchanged,true as other_current_activities_unchanged,true as archive_guard_restored from archive_clear_result;
commit;
