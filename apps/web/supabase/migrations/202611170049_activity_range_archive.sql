begin;
-- Activity archival is independent of accounting periods and money movements.
create table public.activity_archives (
 id uuid primary key,guild_id uuid not null references public.guilds(id),date_from date not null,date_through date not null,
 event_count integer not null check(event_count>0),attendance_snapshot jsonb not null,
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 check(date_from<=date_through),unique(guild_id,id)
);
alter table public.activity_archives enable row level security;
revoke all on public.activity_archives from public,anon,authenticated;
grant select(id,guild_id,date_from,date_through,event_count,created_at) on public.activity_archives to authenticated;
create policy activity_archives_read on public.activity_archives for select to authenticated using(private.is_member(guild_id));
alter table public.events add column activity_archive_id uuid;
alter table public.events add constraint event_activity_archive foreign key(guild_id,activity_archive_id) references public.activity_archives(guild_id,id);
create index events_activity_archive on public.events(guild_id,activity_archive_id,starts_at);
create view private.current_events as select * from public.events where activity_archive_id is null;
revoke all on private.current_events from public,anon,authenticated;
-- Only attendance/report readers use the current set. Detail, stock, sales and payouts retain their original event links.
do $migration$
declare signature text;definition text;
begin
 foreach signature in array array[
 'private.attendance_event_counts(uuid,timestamp with time zone,timestamp with time zone)',
 'private.period_payroll(uuid,date)',
 'private.lifetime_payroll(uuid)',
 'public.command_attendance_data(timestamp with time zone,timestamp with time zone)',
 'public.dashboard_report_before_event_counts(timestamp with time zone,timestamp with time zone)'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if strpos(definition,'public.events')=0 then raise exception 'ARCHIVE_READER_MISMATCH: %',signature;end if;
  execute replace(definition,'public.events','private.current_events');
 end loop;
end $migration$;
create or replace function public.activity_journal(p_from timestamptz,p_until timestamptz,p_filters jsonb default '{}',p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare g uuid;staff boolean;finance boolean;result jsonb;
begin
 select id into g from public.guilds where slug='xd';
 if not private.is_member(g) then raise exception 'FORBIDDEN'; end if;
 staff:=public.has_permission(g,'attendance.manage');finance:=private.finance_staff(g);
 if p_from is null or p_until is null or p_from>=p_until or p_until-p_from>interval '366 days' or p_page not between 1 and 10000 then raise exception 'INVALID_PERIOD'; end if;
 if coalesce(p_filters->>'player','')<>'' and not staff then raise exception 'FORBIDDEN'; end if;
 with base as (
  select e.id,e.title,e.kind,e.starts_at,e.status,e.treasury_source,e.attendance_finalized_at,e.version,e.activity_banner_id,
   coalesce(r.difficulty,'normal') as difficulty,coalesce(r.is_night,false) as is_night,
   e.activity_banner_photo is not null and e.activity_banner_photo<>'' as has_banner,
   case when staff then case when e.status='scheduled' then (select count(*) from public.event_signups s where s.event_id=e.id) else (select count(*) from public.attendance a where a.event_id=e.id and a.mark='present') end end as participants,
   case when staff and e.attendance_finalized_at is not null and e.status='completed' then (select round(100.0*count(*) filter(where a.mark='present')/nullif(count(*) filter(where a.mark in ('present','absent')),0),1) from public.attendance a where a.event_id=e.id) end as percentage,
   case when finance then (select coalesce(sum(w.amount_units),0) from public.treasury_awards w join public.treasury_allocations x on x.id=w.allocation_id and x.voided_at is null join public.treasury_sales s on s.id=x.sale_id and s.voided_at is null join public.treasury_loot l on l.id=s.loot_id where l.event_id=e.id) end as awarded,
   case when finance then (select coalesce(sum((select coalesce(sum(p.amount_units),0) from public.treasury_payouts p where p.award_id=w.id and p.voided_at is null)),0) from public.treasury_awards w join public.treasury_allocations x on x.id=w.allocation_id and x.voided_at is null join public.treasury_sales s on s.id=x.sale_id and s.voided_at is null join public.treasury_loot l on l.id=s.loot_id where l.event_id=e.id) end as paid
  from public.events e left join public.activity_reports r on r.event_id=e.id
  where e.guild_id=g and e.deleted_at is null and not e.inventory_receipt and (case when coalesce(p_filters->>'archive','')='1' then e.activity_archive_id is not null else e.activity_archive_id is null end) and e.starts_at>=p_from and e.starts_at<p_until
   and (coalesce(p_filters->>'source','')='' or e.treasury_source=p_filters->>'source')
   and (coalesce(p_filters->>'kind','')='' or (case when e.kind='pvp' then 'pvp' else 'pve' end)=p_filters->>'kind')
   and (coalesce(p_filters->>'banner','')='' or e.activity_banner_id=(p_filters->>'banner')::uuid)
   and (coalesce(p_filters->>'player','')='' or exists(select 1 from public.attendance a join public.memberships m on m.id=a.membership_id where a.event_id=e.id and a.mark='present' and strpos(lower(m.nickname),lower(p_filters->>'player'))>0) or exists(select 1 from public.event_signups s join public.memberships m on m.id=s.membership_id where s.event_id=e.id and strpos(lower(m.nickname),lower(p_filters->>'player'))>0))
 ), labelled as (
  select *,case when status='cancelled' then 'cancelled' when status='scheduled' then 'scheduled' when awarded>paid then 'pending_payout' when awarded>0 and paid>=awarded then 'paid' when attendance_finalized_at is null then 'unconfirmed' else 'completed' end as journal_status from base
 ), filtered as (
  select * from labelled where coalesce(p_filters->>'status','')='' or journal_status=p_filters->>'status' or (p_filters->>'status'='all_completed' and status='completed')
 ), paged as (select * from filtered order by starts_at desc,id desc offset (p_page-1)*15 limit 15)
 select jsonb_build_object('total',(select count(*) from filtered),'page',p_page,'can_view_roster',staff,'kpis',jsonb_build_object('total',(select count(*) from filtered),'average',(select round(avg(participants),1) from filtered where status='completed' and attendance_finalized_at is not null),'best',(select max(participants) from filtered where status='completed' and attendance_finalized_at is not null),'cancelled',(select count(*) from filtered where status='cancelled')),'rows',coalesce((select jsonb_agg(to_jsonb(p)-'awarded'-'paid' order by p.starts_at desc,p.id desc) from paged p),'[]')) into result;
 return result;
end $$;
create or replace function private.guard_closed_event() returns trigger language plpgsql security definer set search_path='' as $$
declare g uuid;old_time timestamptz;new_time timestamptz;
begin
 if TG_TABLE_NAME='events' and TG_OP='UPDATE' then
  if old.activity_archive_id is null and new.activity_archive_id is not null
   and (to_jsonb(new)-'activity_archive_id'-'version')=(to_jsonb(old)-'activity_archive_id'-'version')
   and public.has_permission(new.guild_id,'periods.close') and public.has_permission(new.guild_id,'events.manage') then return new;end if;
 end if;
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
create function private.guard_activity_archive() returns trigger language plpgsql security definer set search_path='' as $$
declare eid uuid;arch uuid;
begin
 if TG_TABLE_NAME='events' then
  if TG_OP<>'INSERT' and old.activity_archive_id is not null then raise exception 'ACTIVITY_ARCHIVED';end if;
 else
  if TG_OP<>'INSERT' then eid:=old.event_id;else eid:=new.event_id;end if;
  select activity_archive_id into arch from public.events where id=eid for update;
  if arch is not null then raise exception 'ACTIVITY_ARCHIVED';end if;
  if TG_OP='UPDATE' and new.event_id is distinct from old.event_id then
   select activity_archive_id into arch from public.events where id=new.event_id for update;
   if arch is not null then raise exception 'ACTIVITY_ARCHIVED';end if;
  end if;
 end if;
 if TG_OP='DELETE' then return old;end if;return new;
end $$;
revoke all on function private.guard_activity_archive() from public,anon,authenticated;
create trigger activity_archived_event before update or delete on public.events for each row execute function private.guard_activity_archive();
create trigger activity_archived_attendance before insert or update or delete on public.attendance for each row execute function private.guard_activity_archive();
create trigger activity_archived_claim before insert or update or delete on public.participation_claims for each row execute function private.guard_activity_archive();
create trigger activity_archived_report before insert or update or delete on public.activity_reports for each row execute function private.guard_activity_archive();
create trigger activity_archived_evidence before insert or update or delete on public.activity_evidence for each row execute function private.guard_activity_archive();
create trigger activity_archived_signup before insert or update or delete on public.event_signups for each row execute function private.guard_activity_archive();
create function public.archive_activities(p_request uuid,p_from date,p_through date) returns integer language plpgsql security definer set search_path='' as $$
declare g uuid;prior public.activity_archives;ids uuid[];snapshot jsonb;n integer;
begin
 select id into g from public.guilds where slug='xd';
 perform private.lock_finance(g,'periods.close');
 if not public.has_permission(g,'events.manage') then raise exception 'FORBIDDEN';end if;
 if p_request is null or p_from is null or p_through is null or not isfinite(p_from) or not isfinite(p_through) or p_from>p_through or p_through-p_from>365 or p_through>(now() at time zone 'UTC')::date then raise exception 'INVALID_PERIOD';end if;
 select * into prior from public.activity_archives where id=p_request;
 if prior.id is not null then
  if prior.guild_id=g and prior.date_from=p_from and prior.date_through=p_through then return prior.event_count;end if;
  raise exception 'REQUEST_CONFLICT';
 end if;
 select array_agg(e.id order by e.id) into ids from (select id from public.events where guild_id=g and activity_archive_id is null and deleted_at is null and not inventory_receipt and starts_at>=p_from::timestamp at time zone 'UTC' and starts_at<(p_through+1)::timestamp at time zone 'UTC' and starts_at<=now() order by id for update) e;
 n:=coalesce(cardinality(ids),0);
 if n=0 then raise exception 'NO_ACTIVITIES';end if;
 if n>10000 then raise exception 'REPORT_TOO_LARGE';end if;
 select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('nickname',m.nickname) order by c.membership_id),'[]') into snapshot from private.attendance_event_counts(g,p_from::timestamp at time zone 'UTC',(p_through+1)::timestamp at time zone 'UTC') c join public.memberships m on m.id=c.membership_id;
 insert into public.activity_archives(id,guild_id,date_from,date_through,event_count,attendance_snapshot,created_by) values(p_request,g,p_from,p_through,n,snapshot,private.viewer_id());
 update public.events set activity_archive_id=p_request,version=version+1 where id=any(ids);
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'activity.archived',p_request,jsonb_build_object('from',p_from,'through',p_through,'count',n));
 return n;
end $$;
revoke all on function public.archive_activities(uuid,date,date) from public,anon;
grant execute on function public.archive_activities(uuid,date,date) to authenticated;
notify pgrst,'reload schema';
commit;
